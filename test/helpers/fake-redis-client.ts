import type { RedisClientLike } from '../../src/engines/redis-engine';

export type FakeRedisMode = 'normal' | 'failing' | 'hanging';

export interface FakeRedisCall {
  command: 'set' | 'get' | 'del';
  args: readonly unknown[];
}

interface StoredValue {
  readonly value: string;
  readonly expiresAt: number;
}

const isValidExpiry = (milliseconds: number): boolean =>
  Number.isInteger(milliseconds) && milliseconds > 0;

export class FakeRedisClient implements RedisClientLike {
  mode: FakeRedisMode = 'normal';
  latencyMs = 0;
  readonly calls: FakeRedisCall[] = [];
  readonly #store = new Map<string, StoredValue>();
  #inFlight = 0;
  #maxInFlight = 0;

  get inFlight(): number {
    return this.#inFlight;
  }

  get maxInFlight(): number {
    return this.#maxInFlight;
  }

  set(
    key: string,
    value: string,
    px: 'PX',
    milliseconds: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  set(
    key: string,
    value: string,
    px: 'PX',
    milliseconds: number,
  ): Promise<'OK' | null>;
  set(
    key: string,
    value: string,
    px: 'PX',
    milliseconds: number,
    nx?: 'NX',
  ): Promise<'OK' | null> {
    const args =
      nx === undefined
        ? [key, value, px, milliseconds]
        : [key, value, px, milliseconds, nx];
    return this.#dispatch('set', args, () =>
      this.#applySet(key, value, milliseconds, nx === 'NX'),
    );
  }

  get(key: string): Promise<string | null> {
    return this.#dispatch('get', [key], () => this.#live(key)?.value ?? null);
  }

  del(key: string): Promise<number> {
    return this.#dispatch('del', [key], () =>
      this.#live(key) && this.#store.delete(key) ? 1 : 0,
    );
  }

  peekRemainingMs(key: string): number | undefined {
    const stored = this.#live(key);
    return stored && stored.expiresAt - performance.now();
  }

  #applySet(
    key: string,
    value: string,
    milliseconds: number,
    onlyIfAbsent: boolean,
  ): 'OK' | null {
    if (!isValidExpiry(milliseconds)) {
      throw new Error("ERR invalid expire time in 'set' command");
    }
    if (onlyIfAbsent && this.#live(key) !== undefined) {
      return null;
    }
    this.#store.set(key, {
      value,
      expiresAt: performance.now() + milliseconds,
    });
    return 'OK';
  }

  #live(key: string): StoredValue | undefined {
    const stored = this.#store.get(key);
    if (stored !== undefined && stored.expiresAt > performance.now()) {
      return stored;
    }
    this.#store.delete(key);
    return undefined;
  }

  #dispatch<T>(
    command: FakeRedisCall['command'],
    args: readonly unknown[],
    execute: () => T,
  ): Promise<T> {
    const mode = this.mode;
    this.calls.push({ command, args });
    this.#inFlight += 1;
    this.#maxInFlight = Math.max(this.#maxInFlight, this.#inFlight);
    if (mode === 'hanging') {
      return new Promise<T>(() => undefined);
    }

    return new Promise<T>((resolve, reject) => {
      const answer = (): void => {
        this.#inFlight -= 1;
        if (mode === 'failing') {
          reject(new Error('fake redis failure'));
          return;
        }
        try {
          resolve(execute());
        } catch (error) {
          reject(error);
        }
      };
      setTimeout(answer, mode === 'normal' ? this.latencyMs : 0);
    });
  }
}
