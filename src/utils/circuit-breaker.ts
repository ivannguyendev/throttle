export type BreakerAdmission = 'closed' | 'probe' | 'open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

const monotonicNow = (): number => performance.now();

export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #consecutiveFailures = 0;
  #open = false;
  #openUntil = 0;
  #probing = false;

  constructor(options: CircuitBreakerOptions) {
    this.#failureThreshold = options.failureThreshold;
    this.#cooldownMs = options.cooldownMs;
    this.#now = options.now ?? monotonicNow;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  admit(): BreakerAdmission {
    if (!this.#open) {
      return 'closed';
    }
    if (this.#probing || this.#now() < this.#openUntil) {
      return 'open';
    }
    this.#probing = true;
    return 'probe';
  }

  recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#open = false;
    this.#probing = false;
  }

  recordFailure(): boolean {
    this.#consecutiveFailures += 1;
    const probeFailed = this.#probing;
    this.#probing = false;
    const thresholdReached =
      !this.#open && this.#consecutiveFailures >= this.#failureThreshold;
    if (!probeFailed && !thresholdReached) {
      return false;
    }
    this.#open = true;
    this.#openUntil = this.#now() + this.#cooldownMs;
    return true;
  }
}
