import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeferred } from '../../helpers/create-deferred';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { waitFor } from '../../helpers/wait-for';
import type { ThrottlePhase } from '../../../src/throttle-types';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

type Run = [string, ThrottlePhase];

const createWindow = (windowMs: number) =>
  new ThrottleWindow('basics:', { windowMs });

const recordRuns = () => {
  const runs: Run[] = [];
  const job =
    (label: string) =>
    (phase: ThrottlePhase): string => {
      runs.push([label, phase]);
      return label;
    };
  return { runs, job };
};

test('the first call runs at once as leading and resolves true', async (t) => {
  const window = createWindow(50);
  t.teardown(() => window.destroy());
  const { runs, job } = recordRuns();

  t.true(await window.job('k', job('first')).exec());

  t.deepEqual(runs, [['first', 'leading']]);
});

test.serial(
  'calls inside the window coalesce into one trailing run of the latest fn',
  async (t) => {
    const window = createWindow(50);
    t.teardown(() => window.destroy());
    const { runs, job } = recordRuns();
    await window.job('k', job('first')).exec();

    const results = await Promise.all([
      window.job('k', job('second')).exec(),
      window.job('k', job('third')).exec(),
    ]);
    await waitFor(() => runs.length === 2);
    await delay(120);

    t.deepEqual(results, [false, false]);
    t.deepEqual(runs, [
      ['first', 'leading'],
      ['third', 'trailing'],
    ]);
  },
);

test.serial(
  'the next window is measured from the end of the run',
  async (t) => {
    const window = createWindow(50);
    t.teardown(() => window.destroy());
    const trailingStarted = createDeferred<number>();
    let leadingEndedAt = 0;

    const leading = window
      .job('k', async () => {
        await delay(80);
        leadingEndedAt = performance.now();
      })
      .exec();
    await delay(10);
    const coalesced = window
      .job('k', () => trailingStarted.resolve(performance.now()))
      .exec();

    t.false(await coalesced);
    t.true(await leading);
    const gapMs = (await trailingStarted.promise) - leadingEndedAt;
    t.true(gapMs >= 45, `trailing started ${gapMs}ms after the leading end`);
  },
);

test.serial(
  'an empty window closes and the next call leads again',
  async (t) => {
    const window = createWindow(30);
    t.teardown(() => window.destroy());
    const { runs, job } = recordRuns();
    await window.job('k', job('first')).exec();
    t.is(window.keyCount, 1);
    t.true(window.timerCount > 0);

    await waitFor(() => window.keyCount === 0);
    t.is(window.timerCount, 0);
    await delay(20);

    t.true(await window.job('k', job('second')).exec());
    t.deepEqual(runs, [
      ['first', 'leading'],
      ['second', 'leading'],
    ]);
  },
);

test.serial('exposes the active, pending, key and timer counts', async (t) => {
  const window = createWindow(30);
  t.teardown(() => window.destroy());
  const started = createDeferred<void>();
  const release = createDeferred<void>();

  const leading = window
    .job('k', async () => {
      started.resolve();
      await release.promise;
    })
    .exec();
  await started.promise;
  const coalesced = window.job('k', () => undefined).exec();

  t.is(window.activeCount, 1);
  t.is(window.pendingCount, 1);
  t.is(window.keyCount, 1);
  release.resolve();
  t.false(await coalesced);
  t.true(await leading);
  await waitFor(() => window.keyCount === 0);
  t.is(window.activeCount, 0);
  t.is(window.pendingCount, 0);
  t.is(window.timerCount, 0);
});
