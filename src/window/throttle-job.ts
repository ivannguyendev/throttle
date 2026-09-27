import type { ThrottleJobFn } from '../throttle-types';
import { assertTimerDelay } from '../utils/timer-registry';

export interface ThrottleJobScheduler {
  schedule<T>(key: string, fn: ThrottleJobFn<T>): Promise<boolean>;
  scheduleAndWait<T>(
    key: string,
    fn: ThrottleJobFn<T>,
    timeoutMs?: number,
  ): Promise<T>;
}

export class ThrottleJob<T> {
  readonly #scheduler: ThrottleJobScheduler;
  readonly #key: string;
  readonly #fn: ThrottleJobFn<T>;

  constructor(
    scheduler: ThrottleJobScheduler,
    key: string,
    fn: ThrottleJobFn<T>,
  ) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('Throttle job key must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('Throttle job fn must be a function');
    }
    this.#scheduler = scheduler;
    this.#key = key;
    this.#fn = fn;
  }

  exec(): Promise<boolean> {
    return this.#scheduler.schedule(this.#key, this.#fn);
  }

  waitFinish(): WaitingThrottleJob<T> {
    return new WaitingThrottleJob(this.#scheduler, this.#key, this.#fn);
  }
}

export class WaitingThrottleJob<T> {
  readonly #scheduler: ThrottleJobScheduler;
  readonly #key: string;
  readonly #fn: ThrottleJobFn<T>;
  readonly #timeoutMs: number | undefined;

  constructor(
    scheduler: ThrottleJobScheduler,
    key: string,
    fn: ThrottleJobFn<T>,
    timeoutMs?: number,
  ) {
    this.#scheduler = scheduler;
    this.#key = key;
    this.#fn = fn;
    this.#timeoutMs = timeoutMs;
  }

  timeout(ms: number): WaitingThrottleJob<T> {
    assertTimerDelay('timeout', ms);
    return new WaitingThrottleJob(this.#scheduler, this.#key, this.#fn, ms);
  }

  exec(): Promise<T> {
    return this.#scheduler.scheduleAndWait(
      this.#key,
      this.#fn,
      this.#timeoutMs,
    );
  }
}
