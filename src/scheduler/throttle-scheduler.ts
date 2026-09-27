import {
  ThrottleDestroyedError,
  ThrottleDroppedError,
  ThrottleTimeoutError,
} from '../throttle-errors';
import type { ThrottleJobFn, ThrottlePhase } from '../throttle-types';
import { withTimeout } from '../utils/with-timeout';
import type { ThrottleJobScheduler } from '../window/throttle-job';
import {
  computeLeaseTiming,
  runKeyWithLease,
  type KeyRunContext,
  type LeaseTiming,
} from './key-run-with-lease';
import { addWaiter, type KeyState } from './key-state';

export interface ThrottleSchedulerConfig extends KeyRunContext {
  readonly windowMs: number;
}

const MAX_REARMS = 10;
const REARM_MIN_DELAY_MS = 10;
const WINDOW_TIMER_SLACK_MS = 2;

// Plans every run of a key (RAM only): a call runs now (leading) or folds
// into one trailing run at the window end; a lost acquire retries when the
// remote window ends (max 10), then drops. ThrottleJob hands calls in through
// ThrottleJobScheduler. After destroy(), registry.ensure() throws.
export class ThrottleScheduler implements ThrottleJobScheduler {
  readonly #config: ThrottleSchedulerConfig;
  readonly #lease: LeaseTiming;

  constructor(config: ThrottleSchedulerConfig) {
    this.#config = config;
    this.#lease = computeLeaseTiming(config.windowMs);
  }

  async schedule<T>(key: string, fn: ThrottleJobFn<T>): Promise<boolean> {
    const state = this.#config.registry.ensure(key, fn);
    state.pending = true;
    return this.#claim(state) ? this.#attempt(state, 'leading') : false;
  }

  scheduleAndWait<T>(
    key: string,
    fn: ThrottleJobFn<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const settled = this.#waitForRun(key, fn);
    if (timeoutMs === undefined) {
      return settled;
    }
    return withTimeout(
      settled,
      timeoutMs,
      () => new ThrottleTimeoutError(key, timeoutMs),
      this.#config.timers,
    );
  }

  async #waitForRun<T>(key: string, fn: ThrottleJobFn<T>): Promise<T> {
    const state = this.#config.registry.ensure(key, fn);
    state.pending = true;
    const settled = addWaiter<T>(state);
    if (this.#claim(state)) {
      this.#attempt(state, 'leading').catch(() => undefined);
    }
    return settled;
  }

  #claim(state: KeyState): boolean {
    if (state.timer !== null || state.busy) {
      return false;
    }
    state.busy = true;
    return true;
  }

  // Shared by leading and trailing runs. Only a leading attempt throws:
  // its caller awaits it. A trailing attempt runs from a timer and just stops.
  async #attempt(state: KeyState, phase: ThrottlePhase): Promise<boolean> {
    const { guard, registry } = this.#config;
    let handedOff = false;
    try {
      const acquired = await guard.acquire(
        this.#fullKey(state),
        this.#lease.ttlMs,
      );
      if (!registry.alive(state)) {
        if (phase === 'leading') {
          throw new ThrottleDestroyedError(state.key);
        }
        return false;
      }
      if (acquired) {
        handedOff = true;
        await runKeyWithLease(this.#config, this.#lease, state, phase, () =>
          this.#reopenWindow(state),
        );
        return true;
      }
      if (phase === 'trailing') {
        state.rearms += 1;
        if (state.rearms > MAX_REARMS) {
          this.#drop(state);
          return false;
        }
      }
      handedOff = await this.#armForRemainingWindow(state);
      if (phase === 'leading' && !registry.alive(state)) {
        throw new ThrottleDestroyedError(state.key);
      }
      return false;
    } finally {
      if (!handedOff) {
        this.#recover(state);
      }
    }
  }

  async #onWindowEnd(state: KeyState): Promise<void> {
    const { registry } = this.#config;
    if (!registry.alive(state)) {
      return;
    }
    if (!state.pending && state.waiters.length === 0) {
      registry.cleanup(state);
      return;
    }
    state.busy = true;
    await this.#attempt(state, 'trailing');
  }

  async #reopenWindow(state: KeyState): Promise<void> {
    const { guard, registry, windowMs } = this.#config;
    if (registry.alive(state)) {
      await guard.extend(this.#fullKey(state), windowMs);
    }
    if (registry.alive(state)) {
      this.#arm(state, windowMs + WINDOW_TIMER_SLACK_MS, 1);
      state.busy = false;
    }
  }

  async #armForRemainingWindow(state: KeyState): Promise<boolean> {
    const { guard, registry, windowMs } = this.#config;
    const delayMs = await guard.remaining(this.#fullKey(state), {
      fallbackMs: windowMs,
      maxMs: this.#lease.ttlMs,
    });
    if (!registry.alive(state)) {
      return false;
    }
    this.#arm(state, delayMs, REARM_MIN_DELAY_MS);
    state.busy = false;
    return true;
  }

  #recover(state: KeyState): void {
    const { registry, windowMs } = this.#config;
    if (!registry.alive(state)) {
      return;
    }
    state.busy = false;
    if (state.pending || state.waiters.length > 0) {
      this.#arm(state, windowMs, REARM_MIN_DELAY_MS);
    } else {
      registry.cleanup(state);
    }
  }

  #arm(state: KeyState, delayMs: number, minDelayMs: number): void {
    const { registry, timers } = this.#config;
    if (!registry.alive(state)) {
      return;
    }
    timers.clear(state.timer);
    state.timer = timers.setTimeout(
      () => {
        state.timer = null;
        return this.#onWindowEnd(state);
      },
      delayMs,
      { minDelayMs },
    );
  }

  #drop(state: KeyState): void {
    const { logger, registry, tag } = this.#config;
    logger.debug(`${tag} rearm limit exceeded`, {
      key: state.key,
      rearms: state.rearms,
    });
    registry.cleanup(state, new ThrottleDroppedError(state.key));
  }

  #fullKey(state: KeyState): string {
    return this.#config.keyPrefix + state.key;
  }
}
