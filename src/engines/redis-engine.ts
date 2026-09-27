import type {
  ThrottleEngine,
  ThrottleEngineSetOptions,
} from './throttle-engine';

export interface RedisClientLike {
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
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface RedisEngineOptions {
  client: RedisClientLike;
}

const isRedisClientLike = (value: unknown): value is RedisClientLike =>
  typeof value === 'object' &&
  value !== null &&
  'set' in value &&
  typeof value.set === 'function' &&
  'get' in value &&
  typeof value.get === 'function' &&
  'del' in value &&
  typeof value.del === 'function';

export class RedisEngine implements ThrottleEngine {
  readonly #client: RedisClientLike;

  constructor(options: RedisEngineOptions) {
    const client: unknown = options?.client;
    if (!isRedisClientLike(client)) {
      throw new TypeError(
        'RedisEngine requires options.client with set(), get() and del() methods, such as an ioredis client',
      );
    }
    this.#client = client;
  }

  async get(key: string): Promise<string | null> {
    return this.#client.get(key);
  }

  async set(
    key: string,
    value: string,
    options: ThrottleEngineSetOptions,
  ): Promise<boolean> {
    const reply = options.NX
      ? await this.#client.set(key, value, 'PX', options.PX, 'NX')
      : await this.#client.set(key, value, 'PX', options.PX);
    return reply === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.#client.del(key);
  }

  // Window keys expire on their own (PX), and a shared Redis has no safe way to delete only this engine's keys.
  async clear(): Promise<void> {}
}
