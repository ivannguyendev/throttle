import {
  assertTimerDelay,
  TimerRegistry,
  type TimerHandle,
} from '../utils/timer-registry';
import type {
  ThrottleEngine,
  ThrottleEngineSetOptions,
} from './throttle-engine';

export interface MemoryEngineOptions {
  sweepIntervalMs?: number;
}

interface StoredEntry {
  readonly value: string;
  readonly expiresAt: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60000;

const now = (): number => performance.now();

const isLive = (entry: StoredEntry, at: number): boolean =>
  entry.expiresAt > at;

export class MemoryEngine implements ThrottleEngine {
  readonly #entries = new Map<string, StoredEntry>();
  readonly #timers = new TimerRegistry();
  readonly #sweepIntervalMs: number;
  #sweeper: TimerHandle | null = null;

  constructor(options: MemoryEngineOptions = {}) {
    const sweepIntervalMs =
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    assertTimerDelay('sweepIntervalMs', sweepIntervalMs);
    this.#sweepIntervalMs = sweepIntervalMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  async get(key: string): Promise<string | null> {
    return this.#liveEntry(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    options: ThrottleEngineSetOptions,
  ): Promise<boolean> {
    if (options.NX && this.#liveEntry(key)) {
      return false;
    }
    this.#entries.set(key, { value, expiresAt: now() + options.PX });
    this.#sweeper ??= this.#timers.setInterval(
      () => this.#sweep(),
      this.#sweepIntervalMs,
    );
    return true;
  }

  async del(key: string): Promise<void> {
    this.#forget(key);
  }

  async clear(): Promise<void> {
    this.#stopSweeper();
    this.#entries.clear();
  }

  #liveEntry(key: string): StoredEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry && isLive(entry, now())) {
      return entry;
    }
    this.#forget(key);
    return undefined;
  }

  #forget(key: string): void {
    if (this.#entries.delete(key) && this.#entries.size === 0) {
      this.#stopSweeper();
    }
  }

  #sweep(): void {
    const sweptAt = now();
    for (const [key, entry] of this.#entries) {
      if (!isLive(entry, sweptAt)) {
        this.#entries.delete(key);
      }
    }
    if (this.#entries.size === 0) {
      this.#stopSweeper();
    }
  }

  #stopSweeper(): void {
    this.#timers.clear(this.#sweeper);
    this.#sweeper = null;
  }
}
