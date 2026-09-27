import type { ThrottleEngine } from '../engines/throttle-engine';
import type { ThrottleLogger } from '../throttle-types';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { describeError } from '../utils/describe-error';
import { createSafeLogger } from '../utils/resolve-throttle-logger';

export interface EngineGuardOptions {
  engine: ThrottleEngine;
  logger: ThrottleLogger;
  tag: string;
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
  clock?: () => number;
}

export interface RemainingWindowOptions {
  fallbackMs: number;
  maxMs: number;
}

type EngineOperation = 'acquire' | 'extend' | 'remaining';

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 10000;

// The stored value is the window end time in epoch ms (D17).
const encodeWindowExpiry = (nowMs: number, ttlMs: number): string =>
  String(nowMs + ttlMs);

// null → the key is gone (0 left); undefined → unreadable value.
function remainingFromWindowExpiry(
  value: unknown,
  nowMs: number,
): number | undefined {
  if (value === null) {
    return 0;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const expiresAt = Number(value);
  if (!Number.isFinite(expiresAt)) {
    return undefined;
  }
  return Math.max(expiresAt - nowMs, 0);
}

export class EngineGuard {
  readonly #engine: ThrottleEngine;
  readonly #logger: ThrottleLogger;
  readonly #tag: string;
  readonly #cooldownMs: number;
  readonly #clock: () => number;
  readonly #breaker: CircuitBreaker;

  constructor(options: EngineGuardOptions) {
    this.#engine = options.engine;
    this.#logger = createSafeLogger(options.logger);
    this.#tag = options.tag;
    this.#cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.#clock = options.clock ?? Date.now;
    this.#breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      cooldownMs: this.#cooldownMs,
      now: options.now,
    });
  }

  get isOpen(): boolean {
    return this.#breaker.isOpen;
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const acquired = await this.#call('acquire', key, true, () =>
      this.#engine.set(key, encodeWindowExpiry(this.#clock(), ttlMs), {
        PX: ttlMs,
        NX: true,
      }),
    );
    return acquired === true;
  }

  async extend(key: string, ttlMs: number): Promise<void> {
    await this.#call('extend', key, undefined, () =>
      this.#engine.set(key, encodeWindowExpiry(this.#clock(), ttlMs), {
        PX: ttlMs,
      }),
    );
  }

  async remaining(
    key: string,
    options: RemainingWindowOptions,
  ): Promise<number> {
    const value = await this.#call('remaining', key, undefined, () =>
      this.#engine.get(key),
    );
    const remainingMs = remainingFromWindowExpiry(value, this.#clock());
    return remainingMs === undefined
      ? options.fallbackMs
      : Math.min(remainingMs, options.maxMs);
  }

  async #call(
    operation: EngineOperation,
    key: string,
    failOpenResult: unknown,
    invoke: () => unknown,
  ): Promise<unknown> {
    if (this.#breaker.admit() === 'open') {
      return failOpenResult;
    }
    try {
      const result = await invoke();
      this.#breaker.recordSuccess();
      return result;
    } catch (error) {
      this.#recordFailure(operation, key, error);
      return failOpenResult;
    }
  }

  #recordFailure(
    operation: EngineOperation,
    key: string,
    error: unknown,
  ): void {
    if (this.#breaker.recordFailure()) {
      this.#logger.debug(`${this.#tag} engine breaker open`, {
        op: operation,
        key,
        cooldownMs: this.#cooldownMs,
        error: describeError(error),
      });
    }
  }
}
