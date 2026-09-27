import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { EngineGuard } from '../../src/scheduler/engine-guard';
import {
  computeLeaseTiming,
  runKeyWithLease,
  type KeyRunContext,
  type LeaseTiming,
} from '../../src/scheduler/key-run-with-lease';
import { addWaiter } from '../../src/scheduler/key-state';
import type { ThrottlePhase } from '../../src/throttle-types';
import { keepEventLoopAlive } from '../helpers/keep-event-loop-alive';
import { createTestRegistry, TEST_TAG } from '../helpers/key-state-fixtures';
import { createRecordingLogger } from '../helpers/recording-logger';
import { StubEngine } from '../helpers/stub-engine';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const LEASE: LeaseTiming = { intervalMs: 20, ttlMs: 50 };

interface ReopenSnapshot {
  stopLease: unknown;
  timerCount: number;
}

const createRun = () => {
  const { registry, timers } = createTestRegistry();
  const { entries, logger } = createRecordingLogger();
  const engine = new StubEngine(() => Promise.resolve(true));
  const context: KeyRunContext = {
    keyPrefix: 'p:',
    timers,
    registry,
    guard: new EngineGuard({ engine, logger, tag: TEST_TAG }),
    logger,
    tag: TEST_TAG,
  };
  const reopens: ReopenSnapshot[] = [];

  const run = (
    fn: (phase: ThrottlePhase) => unknown,
    phase: ThrottlePhase,
    { dead = false } = {},
  ) => {
    const state = registry.ensure('k', fn);
    state.pending = true;
    state.rearms = 3;
    const settled = addWaiter(state);
    settled.catch(() => undefined);
    if (dead) {
      registry.cleanup(state);
    }
    const done = runKeyWithLease(context, LEASE, state, phase, async () => {
      reopens.push({ stopLease: state.stopLease, timerCount: timers.size });
    });
    return { done, settled, state };
  };

  return { engine, entries, reopens, run };
};

test('lease timing is half the window, at least 100 ms, and covers 2 intervals', (t) => {
  t.deepEqual(computeLeaseTiming(1000), { intervalMs: 500, ttlMs: 1000 });
  t.deepEqual(computeLeaseTiming(1001), { intervalMs: 500, ttlMs: 1001 });
  t.deepEqual(computeLeaseTiming(50), { intervalMs: 100, ttlMs: 200 });
});

test('a run settles its covered waiters and resets the run state', async (t) => {
  const { entries, reopens, run } = createRun();
  const phases: ThrottlePhase[] = [];

  const { done, settled, state } = run((phase) => {
    phases.push(phase);
    return 'done';
  }, 'leading');
  await done;

  t.is(await settled, 'done');
  t.deepEqual(phases, ['leading']);
  t.like(state, { pending: false, rearms: 0, stopLease: null });
  t.deepEqual(state.waiters, []);
  t.deepEqual(reopens, [{ stopLease: null, timerCount: 0 }]);
  t.deepEqual(entries, [
    ['info', `${TEST_TAG} run`, { key: 'k', phase: 'leading' }],
  ]);
});

test('a failed leading run rethrows after the lease stops and the window reopens', async (t) => {
  const { entries, reopens, run } = createRun();
  const boom = new Error('boom');

  const { done, settled } = run(() => {
    throw boom;
  }, 'leading');

  t.is(await t.throwsAsync(done), boom);
  t.is(await t.throwsAsync(settled), boom);
  t.deepEqual(reopens, [{ stopLease: null, timerCount: 0 }]);
  t.false(entries.some(([level]) => level === 'error'));
});

test('a failed trailing run is logged, not rethrown', async (t) => {
  const { entries, reopens, run } = createRun();
  const boom = new Error('boom');

  const { done, settled } = run(async () => {
    throw boom;
  }, 'trailing');

  await t.notThrowsAsync(done);
  t.is(await t.throwsAsync(settled), boom);
  t.is(reopens.length, 1);
  t.deepEqual(entries.at(-1), [
    'error',
    `${TEST_TAG} trailing run failed`,
    { key: 'k', phase: 'trailing', error: 'boom' },
  ]);
});

test('a removed state does not call fn but still reopens', async (t) => {
  const { reopens, run } = createRun();
  let calls = 0;

  const { done } = run(
    () => {
      calls += 1;
    },
    'trailing',
    { dead: true },
  );
  await done;

  t.is(calls, 0);
  t.is(reopens.length, 1);
});

test.serial('the lease extends the window while fn runs', async (t) => {
  const { engine, run } = createRun();

  const { done } = run(() => delay(LEASE.intervalMs * 4), 'leading');
  await done;

  const extendCalls = engine.calls.filter((call) => call.intent === 'extend');
  t.true(extendCalls.length >= 1);
  for (const call of extendCalls) {
    t.is(call.args[0], 'p:k');
    t.deepEqual(call.args[2], { PX: LEASE.ttlMs });
  }
});
