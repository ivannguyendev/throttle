import test from 'ava';
import {
  createTestRegistry,
  doneJob,
  recordingWaiter,
} from '../helpers/key-state-fixtures';
import {
  ThrottleDestroyedError,
  ThrottleDroppedError,
} from '../../src/throttle-errors';

test('cleanup rejects every waiter with ThrottleDroppedError by default', (t) => {
  const { registry } = createTestRegistry();
  const state = registry.ensure('k', doneJob);
  const rejections: unknown[] = [];
  state.waiters.push(recordingWaiter(rejections), recordingWaiter(rejections));

  registry.cleanup(state);

  t.is(rejections.length, 2);
  for (const error of rejections) {
    t.true(error instanceof ThrottleDroppedError && error.key === 'k');
  }
  t.deepEqual(state.waiters, []);
  t.is(registry.size, 0);
});

test('cleanup rejects the waiters with the given error', (t) => {
  const { registry } = createTestRegistry();
  const state = registry.ensure('k', doneJob);
  const rejections: unknown[] = [];
  state.waiters.push(recordingWaiter(rejections));
  const failure = new Error('custom failure');

  registry.cleanup(state, failure);

  t.is(rejections.length, 1);
  t.is(rejections[0], failure);
});

test('cleanup clears the window timer and stops the lease', (t) => {
  const { registry, timers } = createTestRegistry();
  const state = registry.ensure('k', doneJob);
  let leaseStops = 0;
  state.timer = timers.setTimeout(() => undefined, 1000);
  state.stopLease = () => {
    leaseStops += 1;
  };

  registry.cleanup(state);

  t.is(timers.size, 0);
  t.like(state, { timer: null, stopLease: null });
  t.is(leaseStops, 1);
});

test('cleanup of a stale state leaves the current state alone', (t) => {
  const { registry } = createTestRegistry();
  const stale = registry.ensure('k', doneJob);
  registry.cleanup(stale);
  const current = registry.ensure('k', doneJob);
  const rejections: unknown[] = [];
  current.waiters.push(recordingWaiter(rejections));

  registry.cleanup(stale);

  t.true(registry.alive(current));
  t.is(registry.size, 1);
  t.deepEqual(rejections, []);
});

test('destroy rejects waiters as destroyed and blocks ensure', (t) => {
  const { registry } = createTestRegistry();
  const rejections: unknown[] = [];
  const a = registry.ensure('a', doneJob);
  a.waiters.push(recordingWaiter(rejections));
  registry.ensure('b', doneJob).waiters.push(recordingWaiter(rejections));

  registry.destroy();

  t.true(registry.destroyed);
  t.is(registry.size, 0);
  t.false(registry.alive(a));
  t.deepEqual(
    rejections.map((error) =>
      error instanceof ThrottleDestroyedError ? error.key : error,
    ),
    ['a', 'b'],
  );
  t.throws(() => registry.ensure('c', doneJob), {
    instanceOf: ThrottleDestroyedError,
  });
  t.notThrows(() => registry.destroy());
});
