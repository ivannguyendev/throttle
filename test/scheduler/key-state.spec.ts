import test from 'ava';
import {
  createTestRegistry,
  doneJob,
  TEST_TAG,
} from '../helpers/key-state-fixtures';
import { addWaiter } from '../../src/scheduler/key-state';

const LARGE_MAP_MESSAGE = `${TEST_TAG} key state map is unusually large`;

test('ensure creates an idle state for a new key', (t) => {
  const { registry } = createTestRegistry();

  const state = registry.ensure('k', doneJob);

  t.like(state, {
    key: 'k',
    fn: doneJob,
    pending: false,
    busy: false,
    rearms: 0,
    timer: null,
    stopLease: null,
  });
  t.deepEqual(state.waiters, []);
  t.is(registry.size, 1);
});

test('ensure returns the existing state and keeps the latest fn', (t) => {
  const { registry } = createTestRegistry();
  const first = registry.ensure('k', doneJob);
  const latest = (): string => 'latest';

  const second = registry.ensure('k', latest);

  t.is(second, first);
  t.is(second.fn, latest);
  t.is(registry.size, 1);
});

test('alive is true only for the state registered under its key', (t) => {
  const { registry } = createTestRegistry();
  const state = registry.ensure('k', doneJob);
  t.true(registry.alive(state));

  registry.cleanup(state);
  const replacement = registry.ensure('k', doneJob);

  t.false(registry.alive(state));
  t.not(replacement, state);
  t.true(registry.alive(replacement));
});

test('addWaiter registers a waiter that settles its promise', async (t) => {
  const { registry } = createTestRegistry();
  const state = registry.ensure('k', doneJob);

  const resolved = addWaiter<string>(state);
  const rejected = addWaiter<string>(state);
  const failure = new Error('run failed');
  t.is(state.waiters.length, 2);
  state.waiters[0]?.resolve('value');
  state.waiters[1]?.reject(failure);

  t.is(await resolved, 'value');
  await t.throwsAsync(rejected, { is: failure });
});

test('counts the busy and the pending states', (t) => {
  const { registry } = createTestRegistry();
  const a = registry.ensure('a', doneJob);
  const b = registry.ensure('b', doneJob);
  registry.ensure('c', doneJob);

  a.busy = true;
  b.busy = true;
  b.pending = true;

  t.is(registry.size, 3);
  t.is(registry.activeCount, 2);
  t.is(registry.pendingCount, 1);
});

test('warns about a large map at most once per interval', (t) => {
  const clock = { now: 0 };
  const { entries, registry } = createTestRegistry({
    sizeWarnThreshold: 2,
    sizeWarnIntervalMs: 1000,
    now: () => clock.now,
  });
  registry.ensure('a', doneJob);
  registry.ensure('b', doneJob);
  t.deepEqual(entries, []);

  registry.ensure('c', doneJob);
  clock.now = 999;
  registry.ensure('d', doneJob);
  t.deepEqual(entries, [['debug', LARGE_MAP_MESSAGE, { size: 3 }]]);

  clock.now = 1000;
  registry.ensure('d', doneJob);
  registry.ensure('e', doneJob);
  t.deepEqual(entries, [
    ['debug', LARGE_MAP_MESSAGE, { size: 3 }],
    ['debug', LARGE_MAP_MESSAGE, { size: 5 }],
  ]);
});

test('uses a default size warning threshold of 5000 keys', (t) => {
  const { entries, registry } = createTestRegistry();
  for (let index = 0; index < 5000; index += 1) {
    registry.ensure(`k${index}`, doneJob);
  }
  t.is(entries.length, 0);

  registry.ensure('one-more', doneJob);

  t.deepEqual(entries, [['debug', LARGE_MAP_MESSAGE, { size: 5001 }]]);
});
