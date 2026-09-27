import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeferred } from '../../helpers/create-deferred';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { StubEngine } from '../../helpers/stub-engine';
import { ThrottleDestroyedError } from '../../../src/throttle-errors';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const hang = (): Promise<never> => new Promise<never>(() => undefined);

test.serial(
  'destroy during a pending acquire rejects the calls and re-creates nothing',
  async (t) => {
    const acquire = createDeferred<boolean>();
    const engine = new StubEngine((operation) =>
      operation === 'acquire' ? acquire.promise : Promise.resolve(null),
    );
    const window = new ThrottleWindow('destroy:', { engine, windowMs: 30 });
    let runs = 0;
    const job = window.job('k', () => {
      runs += 1;
    });

    const running = job.exec();
    const waiting = job.waitFinish().exec();
    window.destroy();
    acquire.resolve(true);

    await t.throwsAsync(running, { instanceOf: ThrottleDestroyedError });
    await t.throwsAsync(waiting, { instanceOf: ThrottleDestroyedError });
    await delay(60);
    t.is(runs, 0);
    t.is(window.keyCount, 0);
    t.is(window.timerCount, 0);
    t.deepEqual(
      engine.calls.map(({ intent }) => intent),
      ['acquire'],
    );
  },
);

test.serial(
  'destroy during fn resolves the covered waiter and re-arms nothing',
  async (t) => {
    const window = new ThrottleWindow('destroy:', { windowMs: 30 });
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const waiting = window
      .job('k', async () => {
        started.resolve();
        await release.promise;
        return 'finished';
      })
      .waitFinish()
      .exec();
    await started.promise;

    window.destroy();
    release.resolve();

    t.is(await waiting, 'finished');
    await delay(60);
    t.is(window.keyCount, 0);
    t.is(window.timerCount, 0);
  },
);

test.serial(
  'destroy during a hung closing extend returns at once and leaves no timers',
  async (t) => {
    const extendStarted = createDeferred<void>();
    const engine = new StubEngine((operation) => {
      if (operation === 'extend') {
        extendStarted.resolve();
        return hang();
      }
      return Promise.resolve(operation === 'acquire' ? true : null);
    });
    const window = new ThrottleWindow('destroy:', { engine, windowMs: 1000 });
    const running = window.job('k', () => 'done').exec();
    await extendStarted.promise;

    const destroyStartedAt = performance.now();
    window.destroy();
    const destroyMs = performance.now() - destroyStartedAt;

    t.true(destroyMs < 20, `destroy took ${destroyMs}ms`);
    t.is(window.timerCount, 0);
    t.is(window.keyCount, 0);
    const outcome = await Promise.race([
      running.then(() => 'settled'),
      delay(50, 'pending'),
    ]);
    t.is(outcome, 'pending');
    t.is(engine.calls.filter(({ intent }) => intent === 'extend').length, 1);
  },
);
