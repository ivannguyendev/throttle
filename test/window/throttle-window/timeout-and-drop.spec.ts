import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { createRecordingLogger } from '../../helpers/recording-logger';
import { StubEngine } from '../../helpers/stub-engine';
import { waitFor } from '../../helpers/wait-for';
import {
  ThrottleDroppedError,
  ThrottleTimeoutError,
} from '../../../src/throttle-errors';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

test.serial(
  'waitFinish().timeout() rejects in time while fn still completes',
  async (t) => {
    const window = new ThrottleWindow('limits:', { windowMs: 30 });
    t.teardown(() => window.destroy());
    let completed = false;

    const waiting = window
      .job('k', async () => {
        await delay(100);
        completed = true;
        return 'late';
      })
      .waitFinish()
      .timeout(30)
      .exec();

    await t.throwsAsync(waiting, {
      instanceOf: ThrottleTimeoutError,
      message: 'Throttle job for key "k" did not finish within 30ms',
    });
    t.false(completed);
    await waitFor(() => completed);
  },
);

test.serial('a waiter that finishes in time is not affected', async (t) => {
  const window = new ThrottleWindow('limits:', { windowMs: 30 });
  t.teardown(() => window.destroy());

  const value = await window
    .job('k', (phase) => phase)
    .waitFinish()
    .timeout(1000)
    .exec();

  t.is(value, 'leading');
});

test.serial(
  'a hung engine keeps the key busy but timeout() still settles the caller',
  async (t) => {
    const engine = new StubEngine(() => new Promise<never>(() => undefined));
    const window = new ThrottleWindow('limits:', { engine, windowMs: 30 });
    t.teardown(() => window.destroy());
    let runs = 0;

    const waiting = window
      .job('k', () => {
        runs += 1;
      })
      .waitFinish()
      .timeout(50)
      .exec();

    await t.throwsAsync(waiting, { instanceOf: ThrottleTimeoutError });
    t.is(runs, 0);
    t.is(window.activeCount, 1);
    t.false(await window.job('k', () => undefined).exec());
  },
);

test.serial(
  'a window that can never be acquired is dropped after 10 rearms',
  async (t) => {
    const engine = new StubEngine((operation) =>
      Promise.resolve(operation === 'acquire' ? false : null),
    );
    const { entries, logger } = createRecordingLogger();
    const window = new ThrottleWindow('limits:', {
      engine,
      windowMs: 30,
      debug: logger,
    });
    t.teardown(() => window.destroy());
    let runs = 0;

    const waiting = window
      .job('k', () => {
        runs += 1;
      })
      .waitFinish()
      .exec();

    await t.throwsAsync(waiting, { instanceOf: ThrottleDroppedError });
    t.is(runs, 0);
    t.is(window.keyCount, 0);
    t.is(window.timerCount, 0);
    t.is(engine.calls.filter(({ intent }) => intent === 'acquire').length, 12);
    t.deepEqual(entries, [
      [
        'debug',
        '[throttle:limits] rearm limit exceeded',
        { key: 'k', rearms: 11 },
      ],
    ]);
  },
);
