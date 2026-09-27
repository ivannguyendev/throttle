import type { ThrottleLogger, ThrottlePhase } from '../throttle-types';
import { describeError } from '../utils/describe-error';
import type { TimerRegistry } from '../utils/timer-registry';
import type { EngineGuard } from './engine-guard';
import type { KeyState, KeyStateRegistry } from './key-state';

export interface KeyRunContext {
  readonly keyPrefix: string;
  readonly timers: TimerRegistry;
  readonly registry: KeyStateRegistry;
  readonly guard: EngineGuard;
  readonly logger: ThrottleLogger;
  readonly tag: string;
}

export interface LeaseTiming {
  readonly intervalMs: number;
  readonly ttlMs: number;
}

const LEASE_MIN_INTERVAL_MS = 100;

// The lease re-extends the window while fn runs, so a run longer than
// windowMs never lets another instance acquire the same key.
export function computeLeaseTiming(windowMs: number): LeaseTiming {
  const intervalMs = Math.max(Math.floor(windowMs / 2), LEASE_MIN_INTERVAL_MS);
  return { intervalMs, ttlMs: Math.max(windowMs, 2 * intervalMs) };
}

// One run of a key: lease on, fn, settle covered waiters, lease off, then
// reopenWindow. reopenWindow is awaited here (not by the caller) to keep the
// closing extend in the same microtask as the waiters' settlement.
export async function runKeyWithLease(
  context: KeyRunContext,
  lease: LeaseTiming,
  state: KeyState,
  phase: ThrottlePhase,
  reopenWindow: () => Promise<void>,
): Promise<void> {
  state.rearms = 0;
  const stopLease = startLease(context, lease, state);
  state.stopLease = stopLease;
  try {
    await runCovered(context, state, phase);
  } finally {
    stopLease();
    if (state.stopLease === stopLease) {
      state.stopLease = null;
    }
    await reopenWindow();
  }
}

function startLease(
  { keyPrefix, timers, registry, guard }: KeyRunContext,
  lease: LeaseTiming,
  state: KeyState,
): () => void {
  const fullKey = keyPrefix + state.key;
  let extending = false;
  const handle = timers.setInterval(() => {
    if (extending || !registry.alive(state)) {
      return undefined;
    }
    extending = true;
    return guard.extend(fullKey, lease.ttlMs).finally(() => {
      extending = false;
    });
  }, lease.intervalMs);
  return () => timers.clear(handle);
}

// Covers every waiter registered before fn starts. Only a leading run
// rethrows (backpressure); a failed trailing run is logged instead.
async function runCovered(
  { registry, logger, tag }: KeyRunContext,
  state: KeyState,
  phase: ThrottlePhase,
): Promise<void> {
  if (!registry.alive(state)) {
    return;
  }
  const fn = state.fn;
  state.pending = false;
  const covered = state.waiters.splice(0);
  try {
    logger.info(`${tag} run`, { key: state.key, phase });
    const value = await fn(phase);
    for (const waiter of covered) {
      waiter.resolve(value);
    }
  } catch (error) {
    for (const waiter of covered) {
      waiter.reject(error);
    }
    if (phase === 'leading') {
      throw error;
    }
    logger.error(`${tag} trailing run failed`, {
      key: state.key,
      phase,
      error: describeError(error),
    });
  }
}
