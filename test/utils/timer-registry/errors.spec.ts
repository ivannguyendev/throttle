import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { captureUnhandledRejections } from '../../helpers/capture-unhandled-rejections';
import { TimerRegistry } from '../../../src/utils/timer-registry';

test.serial('a throwing callback is reported to onCallbackError', async (t) => {
  const failure = new Error('callback failed');
  const reported: unknown[] = [];
  const timers = new TimerRegistry((error) => reported.push(error));

  timers.setTimeout(() => {
    throw failure;
  }, 10);
  await delay(60);

  t.deepEqual(reported, [failure]);
  t.is(timers.size, 0);
});

test.serial(
  'a rejecting async callback is reported to onCallbackError',
  async (t) => {
    const failure = new Error('async callback failed');
    const reported: unknown[] = [];
    const timers = new TimerRegistry((error) => reported.push(error));

    timers.setTimeout(async () => {
      throw failure;
    }, 10);
    await delay(60);

    t.deepEqual(reported, [failure]);
  },
);

test.serial(
  'callback errors are swallowed without onCallbackError',
  async (t) => {
    const timers = new TimerRegistry();
    let laterCalls = 0;

    timers.setTimeout(() => {
      throw new Error('callback failed');
    }, 10);
    timers.setTimeout(() => {
      laterCalls += 1;
    }, 20);
    await delay(70);

    t.is(laterCalls, 1);
  },
);

test.serial('a throwing onCallbackError is swallowed', async (t) => {
  const timers = new TimerRegistry(() => {
    throw new Error('handler failed');
  });
  let ticks = 0;

  const interval = timers.setInterval(() => {
    ticks += 1;
    throw new Error('callback failed');
  }, 10);
  await delay(70);
  timers.clear(interval);

  t.true(ticks >= 2);
});

test.serial('a rejecting async onCallbackError is absorbed', async (t) => {
  let handlerCalls = 0;
  const timers = new TimerRegistry(async () => {
    handlerCalls += 1;
    throw new Error('async handler failed');
  });

  const unhandledReasons = await captureUnhandledRejections(async () => {
    timers.setTimeout(() => {
      throw new Error('callback failed');
    }, 5);
    await delay(40);
  });

  t.is(handlerCalls, 1);
  t.deepEqual(unhandledReasons, []);
});
