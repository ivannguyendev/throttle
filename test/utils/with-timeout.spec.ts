import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { captureUnhandledRejections } from '../helpers/capture-unhandled-rejections';
import { createDeferred } from '../helpers/create-deferred';
import { keepEventLoopAlive } from '../helpers/keep-event-loop-alive';
import { TimerRegistry } from '../../src/utils/timer-registry';
import { withTimeout } from '../../src/utils/with-timeout';

const createTimeoutError = (): Error => new Error('deadline exceeded');
const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

test.serial(
  'resolves with the value when the promise wins the race',
  async (t) => {
    const timers = new TimerRegistry();

    const value = await withTimeout(
      delay(10, 'ok'),
      200,
      createTimeoutError,
      timers,
    );

    t.is(value, 'ok');
    t.is(timers.size, 0);
  },
);

test.serial(
  'rejects with the created error when the deadline wins',
  async (t) => {
    const timers = new TimerRegistry();
    const timeoutError = new Error('engine timeout');
    const pending = createDeferred<string>();

    const racing = withTimeout(pending.promise, 20, () => timeoutError, timers);
    t.is(timers.size, 1);
    await t.throwsAsync(racing, { is: timeoutError });

    t.is(timers.size, 0);
    pending.resolve('too late');
  },
);

test('propagates the original rejection and clears the deadline', async (t) => {
  const timers = new TimerRegistry();
  const failure = new Error('engine failed');

  await t.throwsAsync(
    withTimeout(Promise.reject(failure), 200, createTimeoutError, timers),
    { is: failure },
  );

  t.is(timers.size, 0);
});

test.serial(
  'a late rejection after the timeout is not unhandled',
  async (t) => {
    const timers = new TimerRegistry();
    const pending = createDeferred<string>();

    const unhandledReasons = await captureUnhandledRejections(async () => {
      await t.throwsAsync(
        withTimeout(pending.promise, 10, createTimeoutError, timers),
        { message: 'deadline exceeded' },
      );
      pending.reject(new Error('late engine failure'));
    }, 50);

    t.deepEqual(unhandledReasons, []);
  },
);

test.serial('rejects with the error thrown by createError', async (t) => {
  const timers = new TimerRegistry();
  const pending = createDeferred<string>();
  const factoryFailure = new Error('createError failed');
  const throwingCreateError = (): Error => {
    throw factoryFailure;
  };

  await t.throwsAsync(
    withTimeout(pending.promise, 10, throwingCreateError, timers),
    { is: factoryFailure },
  );

  t.is(timers.size, 0);
  pending.resolve('too late');
});

test.serial(
  'the deadline timer survives clearAll and still fires',
  async (t) => {
    const timers = new TimerRegistry();
    const pending = createDeferred<string>();

    const racing = withTimeout(pending.promise, 20, createTimeoutError, timers);
    timers.clearAll();
    t.is(timers.size, 1);

    await t.throwsAsync(racing, { message: 'deadline exceeded' });
    t.is(timers.size, 0);
    pending.resolve('too late');
  },
);
