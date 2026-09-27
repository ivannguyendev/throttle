import test from 'ava';
import {
  MAX_TIMER_DELAY_MS,
  assertTimerDelay,
  normalizeDelay,
} from '../../../src/utils/timer-registry';

test('MAX_TIMER_DELAY_MS is the largest signed 32-bit integer', (t) => {
  t.is(MAX_TIMER_DELAY_MS, 2 ** 31 - 1);
});

test('normalizeDelay maps edge inputs into the timer range', (t) => {
  t.is(normalizeDelay(Number.NaN), 1);
  t.is(normalizeDelay(Number.POSITIVE_INFINITY), MAX_TIMER_DELAY_MS);
  t.is(normalizeDelay(Number.NEGATIVE_INFINITY), 1);
  t.is(normalizeDelay(-5), 1);
  t.is(normalizeDelay(0), 1);
  t.is(normalizeDelay(1.7), 1);
  t.is(normalizeDelay(250), 250);
  t.is(normalizeDelay(2 ** 31), MAX_TIMER_DELAY_MS);
});

test('normalizeDelay honours a custom minimum delay', (t) => {
  t.is(normalizeDelay(5, 100), 100);
  t.is(normalizeDelay(150.9, 100), 150);
  t.is(normalizeDelay(Number.NaN, 100), 100);
  t.is(normalizeDelay(Number.POSITIVE_INFINITY, 100), MAX_TIMER_DELAY_MS);
});

test('normalizeDelay sanitises the minimum delay itself', (t) => {
  t.is(normalizeDelay(500, Number.NaN), 500);
  t.is(normalizeDelay(Number.NaN, Number.NaN), 1);
  t.is(normalizeDelay(0, Number.POSITIVE_INFINITY), 1);
  t.is(normalizeDelay(Number.NaN, 3_000_000_000), MAX_TIMER_DELAY_MS);
  t.is(normalizeDelay(10, 3_000_000_000), MAX_TIMER_DELAY_MS);
  t.is(normalizeDelay(Number.NaN, 0), 1);
  t.is(normalizeDelay(-1, 0), 1);
  t.is(normalizeDelay(1, 2.9), 2);
});

test('assertTimerDelay accepts integers from 1 to MAX_TIMER_DELAY_MS', (t) => {
  t.notThrows(() => assertTimerDelay('windowMs', 1));
  t.notThrows(() => assertTimerDelay('windowMs', 1000));
  t.notThrows(() => assertTimerDelay('windowMs', MAX_TIMER_DELAY_MS));
});

const invalidDelays: unknown[] = [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 31,
  '10',
  undefined,
  null,
];

const receivedDescriptions: Array<[value: unknown, description: string]> = [
  [1.5, '1.5'],
  [null, 'null'],
  ['10', 'string'],
  [undefined, 'undefined'],
];

test('assertTimerDelay describes the received value in its message', (t) => {
  for (const [value, description] of receivedDescriptions) {
    const error = t.throws(() => assertTimerDelay('windowMs', value), {
      instanceOf: RangeError,
    });

    t.true(error?.message.endsWith(`received ${description}`));
  }
});

for (const value of invalidDelays) {
  const label = typeof value === 'string' ? `"${value}"` : String(value);

  test(`assertTimerDelay rejects ${label} with a RangeError naming the option`, (t) => {
    t.throws(() => assertTimerDelay('windowMs', value), {
      instanceOf: RangeError,
      message: /windowMs/,
    });
  });
}
