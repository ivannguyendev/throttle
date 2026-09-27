import {
  ThrottleDestroyedError,
  ThrottleDroppedError,
} from '../throttle-errors';
import type { ThrottleJobFn, ThrottleLogger } from '../throttle-types';
import type { TimerHandle, TimerRegistry } from '../utils/timer-registry';

export interface KeyWaiter {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export interface KeyState {
  readonly key: string;
  fn: ThrottleJobFn<unknown>;
  pending: boolean;
  busy: boolean;
  rearms: number;
  timer: TimerHandle | null;
  stopLease: (() => void) | null;
  waiters: KeyWaiter[];
}

export interface KeyStateRegistryOptions {
  timers: TimerRegistry;
  logger: ThrottleLogger;
  tag: string;
  sizeWarnThreshold?: number;
  sizeWarnIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_SIZE_WARN_THRESHOLD = 5000;
const DEFAULT_SIZE_WARN_INTERVAL_MS = 60000;

const monotonicNow = (): number => performance.now();

const createKeyState = (key: string, fn: ThrottleJobFn<unknown>): KeyState => ({
  key,
  fn,
  pending: false,
  busy: false,
  rearms: 0,
  timer: null,
  stopLease: null,
  waiters: [],
});

export const addWaiter = <T>(state: KeyState): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    state.waiters.push({ resolve: (value) => resolve(value as T), reject });
  });

export class KeyStateRegistry {
  readonly #states = new Map<string, KeyState>();
  readonly #timers: TimerRegistry;
  readonly #logger: ThrottleLogger;
  readonly #tag: string;
  readonly #sizeWarnThreshold: number;
  readonly #sizeWarnIntervalMs: number;
  readonly #now: () => number;
  #lastSizeWarnAt: number | null = null;
  #destroyed = false;

  constructor(options: KeyStateRegistryOptions) {
    this.#timers = options.timers;
    this.#logger = options.logger;
    this.#tag = options.tag;
    this.#sizeWarnThreshold =
      options.sizeWarnThreshold ?? DEFAULT_SIZE_WARN_THRESHOLD;
    this.#sizeWarnIntervalMs =
      options.sizeWarnIntervalMs ?? DEFAULT_SIZE_WARN_INTERVAL_MS;
    this.#now = options.now ?? monotonicNow;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get size(): number {
    return this.#states.size;
  }

  get activeCount(): number {
    return this.#count((state) => state.busy);
  }

  get pendingCount(): number {
    return this.#count((state) => state.pending);
  }

  ensure(key: string, fn: ThrottleJobFn<unknown>): KeyState {
    if (this.#destroyed) {
      throw new ThrottleDestroyedError(key);
    }
    const existing = this.#states.get(key);
    if (existing) {
      existing.fn = fn;
      return existing;
    }
    const state = createKeyState(key, fn);
    this.#states.set(key, state);
    this.#warnIfUnusuallyLarge();
    return state;
  }

  alive(state: KeyState): boolean {
    return !this.#destroyed && this.#states.get(state.key) === state;
  }

  cleanup(state: KeyState, error?: unknown): void {
    this.#timers.clear(state.timer);
    state.timer = null;
    const stopLease = state.stopLease;
    state.stopLease = null;
    stopLease?.();
    const reason = error ?? new ThrottleDroppedError(state.key);
    for (const waiter of state.waiters.splice(0)) {
      waiter.reject(reason);
    }
    if (this.#states.get(state.key) === state) {
      this.#states.delete(state.key);
    }
  }

  destroy(): void {
    this.#destroyed = true;
    for (const state of this.#states.values()) {
      this.cleanup(state, new ThrottleDestroyedError(state.key));
    }
  }

  #count(matches: (state: KeyState) => boolean): number {
    let count = 0;
    for (const state of this.#states.values()) {
      if (matches(state)) {
        count += 1;
      }
    }
    return count;
  }

  #warnIfUnusuallyLarge(): void {
    const size = this.#states.size;
    if (size <= this.#sizeWarnThreshold) {
      return;
    }
    const now = this.#now();
    const lastWarnAt = this.#lastSizeWarnAt;
    if (lastWarnAt !== null && now - lastWarnAt < this.#sizeWarnIntervalMs) {
      return;
    }
    this.#lastSizeWarnAt = now;
    this.#logger.debug(`${this.#tag} key state map is unusually large`, {
      size,
    });
  }
}
