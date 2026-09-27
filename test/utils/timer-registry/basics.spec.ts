import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { TimerRegistry } from '../../../src/utils/timer-registry';

const noop = (): void => undefined;

test.serial(
  'setTimeout fires the callback and untracks the timer',
  async (t) => {
    const timers = new TimerRegistry();
    let calls = 0;

    timers.setTimeout(() => {
      calls += 1;
    }, 10);
    t.is(timers.size, 1);
    await delay(60);

    t.is(calls, 1);
    t.is(timers.size, 0);
  },
);

test.serial('setTimeout respects a custom minDelayMs', async (t) => {
  const timers = new TimerRegistry();
  let fired = false;

  timers.setTimeout(
    () => {
      fired = true;
    },
    0,
    { minDelayMs: 50 },
  );
  await delay(10);
  t.false(fired);
  await delay(100);

  t.true(fired);
});

test('every timer kind is unref-ed', (t) => {
  const timers = new TimerRegistry();
  const scheduler = timers.setTimeout(noop, 1000);
  const deadline = timers.setTimeout(noop, 1000, { kind: 'deadline' });
  const interval = timers.setInterval(noop, 1000);

  t.false(scheduler.hasRef());
  t.false(deadline.hasRef());
  t.false(interval.hasRef());

  [scheduler, deadline, interval].forEach((handle) => timers.clear(handle));
  t.is(timers.size, 0);
});

test.serial('setInterval stays tracked until cleared', async (t) => {
  const timers = new TimerRegistry();
  let ticks = 0;

  const interval = timers.setInterval(() => {
    ticks += 1;
  }, 10);
  await delay(70);
  t.true(ticks >= 2);
  t.is(timers.size, 1);

  timers.clear(interval);
  t.is(timers.size, 0);
  const ticksAtClear = ticks;
  await delay(50);

  t.is(ticks, ticksAtClear);
});

test('clear ignores null, undefined and handles it does not own', (t) => {
  const timers = new TimerRegistry();
  const owned = timers.setTimeout(noop, 1000);
  const foreign = setTimeout(noop, 1000);
  foreign.unref();

  t.notThrows(() => {
    timers.clear(null);
    timers.clear(undefined);
    timers.clear(foreign);
  });
  t.is(timers.size, 1);

  clearTimeout(foreign);
  timers.clear(owned);
  t.is(timers.size, 0);
});

test.serial(
  'clearAll cancels scheduler timers and keeps deadline timers',
  async (t) => {
    const timers = new TimerRegistry();
    const fired: string[] = [];

    timers.setTimeout(() => fired.push('scheduler'), 10);
    timers.setInterval(() => fired.push('interval'), 10);
    timers.setTimeout(() => fired.push('deadline'), 10, { kind: 'deadline' });
    timers.clearAll();
    t.is(timers.size, 1);
    await delay(60);

    t.deepEqual(fired, ['deadline']);
    t.is(timers.size, 0);
  },
);

test.serial(
  'delays beyond the timer limit are clamped, not fired at once',
  async (t) => {
    const timers = new TimerRegistry();
    let fired = false;

    const handle = timers.setTimeout(() => {
      fired = true;
    }, 2 ** 31);
    await delay(50);
    timers.clear(handle);

    t.false(fired);
  },
);
