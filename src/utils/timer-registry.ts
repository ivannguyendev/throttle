import { invokeSafely } from './invoke-safely';
import { isPromiseLike } from './is-promise-like';

export const MAX_TIMER_DELAY_MS = 2147483647;

export type TimerKind = 'scheduler' | 'deadline';
export type TimerHandle = NodeJS.Timeout;

export interface TimeoutOptions {
  kind?: TimerKind;
  minDelayMs?: number;
}

export interface IntervalOptions {
  minDelayMs?: number;
}

const clampToTimerRange = (delayMs: number, lowerBoundMs: number): number =>
  Math.min(Math.max(delayMs, lowerBoundMs), MAX_TIMER_DELAY_MS);

const normalizeMinDelay = (minDelayMs: number): number =>
  Number.isFinite(minDelayMs)
    ? clampToTimerRange(Math.floor(minDelayMs), 1)
    : 1;

export function normalizeDelay(delayMs: number, minDelayMs = 1): number {
  const lowerBoundMs = normalizeMinDelay(minDelayMs);
  const wholeDelayMs = Math.floor(delayMs);
  if (Number.isNaN(wholeDelayMs)) {
    return lowerBoundMs;
  }
  return clampToTimerRange(wholeDelayMs, lowerBoundMs);
}

const describeReceivedValue = (value: unknown): string =>
  typeof value === 'number' || value === null ? String(value) : typeof value;

export function assertTimerDelay(
  name: string,
  value: unknown,
): asserts value is number {
  const isValidDelay =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TIMER_DELAY_MS;
  if (!isValidDelay) {
    throw new RangeError(
      `${name} must be an integer between 1 and ${MAX_TIMER_DELAY_MS}, received ${describeReceivedValue(value)}`,
    );
  }
}

export class TimerRegistry {
  readonly #timers = new Map<TimerHandle, TimerKind>();
  readonly #onCallbackError: (error: unknown) => void;

  constructor(onCallbackError: (error: unknown) => void = () => undefined) {
    this.#onCallbackError = onCallbackError;
  }

  get size(): number {
    return this.#timers.size;
  }

  setTimeout(
    callback: () => void,
    delayMs: number,
    options: TimeoutOptions = {},
  ): TimerHandle {
    const handle = globalThis.setTimeout(
      () => {
        this.#timers.delete(handle);
        this.#runGuarded(callback);
      },
      normalizeDelay(delayMs, options.minDelayMs),
    );
    return this.#track(handle, options.kind ?? 'scheduler');
  }

  setInterval(
    callback: () => void,
    intervalMs: number,
    options: IntervalOptions = {},
  ): TimerHandle {
    const handle = globalThis.setInterval(
      () => this.#runGuarded(callback),
      normalizeDelay(intervalMs, options.minDelayMs),
    );
    return this.#track(handle, 'scheduler');
  }

  clear(handle: TimerHandle | null | undefined): void {
    if (!handle || !this.#timers.has(handle)) {
      return;
    }
    globalThis.clearTimeout(handle);
    this.#timers.delete(handle);
  }

  clearAll(): void {
    for (const [handle, kind] of this.#timers) {
      if (kind === 'scheduler') {
        this.clear(handle);
      }
    }
  }

  #track(handle: TimerHandle, kind: TimerKind): TimerHandle {
    handle.unref();
    this.#timers.set(handle, kind);
    return handle;
  }

  #runGuarded(callback: () => void): void {
    try {
      const result: unknown = callback();
      if (isPromiseLike(result)) {
        result.then(undefined, (error: unknown) => this.#reportError(error));
      }
    } catch (error) {
      this.#reportError(error);
    }
  }

  #reportError(error: unknown): void {
    invokeSafely(() => this.#onCallbackError(error));
  }
}
