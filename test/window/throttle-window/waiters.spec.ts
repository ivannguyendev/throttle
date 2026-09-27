import test from 'ava';
import { createDeferred } from '../../helpers/create-deferred';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { StubEngine } from '../../helpers/stub-engine';
import { waitFor } from '../../helpers/wait-for';
import type { ThrottlePhase } from '../../../src/throttle-types';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const createWindow = () => new ThrottleWindow('waiters:', { windowMs: 30 });

const createGatedWindow = (acquire: () => Promise<boolean>) => {
  const engine = new StubEngine((operation) => {
    if (operation === 'acquire') {
      return acquire();
    }
    return Promise.resolve(
      operation === 'get' ? String(Date.now() + 30) : true,
    );
  });
  return new ThrottleWindow('waiters:', {
    engine,
    windowMs: 30,
  });
};

const recordPhases = () => {
  const phases: ThrottlePhase[] = [];
  const job = (phase: ThrottlePhase): number => phases.push(phase);
  return { job, phases };
};

test.serial(
  'waitFinish resolves with the leading value, then with the trailing value',
  async (t) => {
    const window = createWindow();
    t.teardown(() => window.destroy());

    const leading = window.job('k', (phase) => `first:${phase}`);
    t.is(await leading.waitFinish().exec(), 'first:leading');
    const trailing = window.job('k', (phase) => `second:${phase}`);
    t.is(await trailing.waitFinish().exec(), 'second:trailing');
  },
);

test.serial('waiters of one window share the value of one run', async (t) => {
  const window = createWindow();
  t.teardown(() => window.destroy());
  const { job, phases } = recordPhases();
  await window.job('k', job).exec();

  const values = await Promise.all([
    window.job('k', job).waitFinish().exec(),
    window.job('k', job).waitFinish().exec(),
    window.job('k', job).waitFinish().exec(),
  ]);

  t.deepEqual(values, [2, 2, 2]);
  t.deepEqual(phases, ['leading', 'trailing']);
});

test.serial(
  'a call that arrives while fn runs is covered by the next run',
  async (t) => {
    const window = createWindow();
    t.teardown(() => window.destroy());
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    let runCount = 0;
    const job = async (): Promise<number> => {
      runCount += 1;
      const run = runCount;
      if (run === 1) {
        started.resolve();
        await release.promise;
      }
      return run;
    };

    const first = window.job('k', job).waitFinish().exec();
    await started.promise;
    const second = window.job('k', job).waitFinish().exec();
    release.resolve();

    t.is(await first, 1);
    t.is(await second, 2);
  },
);

test.serial(
  'calls made during a won leading acquire are covered by the leading run',
  async (t) => {
    const acquire = createDeferred<boolean>();
    const window = createGatedWindow(() => acquire.promise);
    t.teardown(() => window.destroy());
    const { job, phases } = recordPhases();

    const leader = window.job('k', job).exec();
    const follower = window.job('k', job).waitFinish().exec();
    acquire.resolve(true);

    t.true(await leader);
    t.is(await follower, 1);
    await waitFor(() => window.keyCount === 0);
    t.deepEqual(phases, ['leading']);
  },
);

test.serial(
  'calls made during a lost leading acquire are covered by the trailing run',
  async (t) => {
    const firstAcquire = createDeferred<boolean>();
    let acquireCount = 0;
    const window = createGatedWindow(() => {
      acquireCount += 1;
      return acquireCount === 1 ? firstAcquire.promise : Promise.resolve(true);
    });
    t.teardown(() => window.destroy());
    const { job, phases } = recordPhases();

    const leader = window.job('k', job).exec();
    const follower = window.job('k', job).waitFinish().exec();
    firstAcquire.resolve(false);

    t.false(await leader);
    t.is(await follower, 1);
    t.deepEqual(phases, ['trailing']);
  },
);
