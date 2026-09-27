import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { CircuitBreaker } from '../../src/utils/circuit-breaker';

const createBreaker = () => {
  const clock = { now: 0 };
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 1000,
    now: () => clock.now,
  });
  return { breaker, clock };
};

const recordFailures = (breaker: CircuitBreaker, times: number): boolean[] =>
  Array.from({ length: times }, () => breaker.recordFailure());

const openThenElapseCooldown = () => {
  const { breaker, clock } = createBreaker();
  recordFailures(breaker, 3);
  clock.now = 1000;
  return { breaker, clock };
};

test('stays closed below the failure threshold', (t) => {
  const { breaker } = createBreaker();

  t.deepEqual(recordFailures(breaker, 2), [false, false]);
  t.is(breaker.admit(), 'closed');
  t.false(breaker.isOpen);
});

test('a success resets the consecutive failure count', (t) => {
  const { breaker } = createBreaker();
  recordFailures(breaker, 2);

  breaker.recordSuccess();

  t.deepEqual(recordFailures(breaker, 2), [false, false]);
  t.is(breaker.admit(), 'closed');
});

test('reports the transition into open exactly once', (t) => {
  const { breaker } = createBreaker();

  t.deepEqual(recordFailures(breaker, 5), [false, false, true, false, false]);
  t.true(breaker.isOpen);
});

test('refuses admission while the cooldown runs', (t) => {
  const { breaker, clock } = createBreaker();
  recordFailures(breaker, 3);

  t.is(breaker.admit(), 'open');
  clock.now = 999;
  t.is(breaker.admit(), 'open');
});

test('admits exactly one probe once the cooldown has elapsed', (t) => {
  const { breaker } = openThenElapseCooldown();

  t.deepEqual(
    [breaker.admit(), breaker.admit(), breaker.admit()],
    ['probe', 'open', 'open'],
  );
  t.true(breaker.isOpen);
});

test('a successful probe closes the breaker', (t) => {
  const { breaker } = openThenElapseCooldown();
  breaker.admit();

  breaker.recordSuccess();

  t.false(breaker.isOpen);
  t.is(breaker.admit(), 'closed');
  t.deepEqual(recordFailures(breaker, 2), [false, false]);
});

test('a failed probe re-opens the breaker for a new cooldown', (t) => {
  const { breaker, clock } = openThenElapseCooldown();
  breaker.admit();

  t.true(breaker.recordFailure());
  t.is(breaker.admit(), 'open');
  clock.now = 1999;
  t.is(breaker.admit(), 'open');
  clock.now = 2000;
  t.is(breaker.admit(), 'probe');
});

test('failures while already open do not extend the cooldown', (t) => {
  const { breaker, clock } = createBreaker();
  recordFailures(breaker, 3);
  clock.now = 500;

  t.false(breaker.recordFailure());
  clock.now = 1000;
  t.is(breaker.admit(), 'probe');
});

test('a late failure after the cooldown still leaves room for a probe', (t) => {
  const { breaker } = openThenElapseCooldown();

  t.false(breaker.recordFailure());

  t.is(breaker.admit(), 'probe');
});

test.serial('defaults to the monotonic performance clock', async (t) => {
  const breaker = new CircuitBreaker({
    failureThreshold: 1,
    cooldownMs: 20,
  });

  t.true(breaker.recordFailure());
  t.is(breaker.admit(), 'open');
  await delay(50);

  t.is(breaker.admit(), 'probe');
});
