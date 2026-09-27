import { MemoryEngine } from '../engines/memory-engine';
import type { ThrottleEngine } from '../engines/throttle-engine';
import { EngineGuard } from '../scheduler/engine-guard';
import { KeyStateRegistry } from '../scheduler/key-state';
import { ThrottleScheduler } from '../scheduler/throttle-scheduler';
import type {
  ThrottleJobFn,
  ThrottleLogger,
  ThrottleWindowOptions,
} from '../throttle-types';
import { describeError } from '../utils/describe-error';
import { invokeSafely } from '../utils/invoke-safely';
import { resolveThrottleLogger } from '../utils/resolve-throttle-logger';
import { assertTimerDelay, TimerRegistry } from '../utils/timer-registry';
import { ThrottleJob } from './throttle-job';

export interface ResolvedThrottleWindowOptions {
  readonly keyPrefix: string;
  readonly engine: ThrottleEngine;
  readonly ownsEngine: boolean;
  readonly windowMs: number;
  readonly tag: string;
  readonly logger: ThrottleLogger;
}

const DEFAULT_WINDOW_MS = 1000;

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const isThrottleEngine = (value: unknown): value is ThrottleEngine =>
  isObject(value) &&
  'get' in value &&
  typeof value.get === 'function' &&
  'set' in value &&
  typeof value.set === 'function' &&
  'del' in value &&
  typeof value.del === 'function' &&
  'clear' in value &&
  typeof value.clear === 'function';

// Validates the constructor arguments and applies defaults.
// Exported for tests; not part of the public API.
export function resolveThrottleWindowOptions(
  keyPrefix: string,
  options: ThrottleWindowOptions = {},
): ResolvedThrottleWindowOptions {
  if (typeof keyPrefix !== 'string' || keyPrefix.length === 0) {
    throw new TypeError(
      'ThrottleWindow requires keyPrefix to be a non-empty string',
    );
  }
  if (!isObject(options)) {
    throw new TypeError('ThrottleWindow options must be an object');
  }
  const { engine, windowMs = DEFAULT_WINDOW_MS, name, debug } = options;
  if (engine !== undefined && !isThrottleEngine(engine)) {
    throw new TypeError(
      'ThrottleWindow options.engine must implement get(), set(), del() and clear()',
    );
  }
  assertTimerDelay('windowMs', windowMs);
  const logger = resolveThrottleLogger(debug);

  return {
    keyPrefix,
    engine: engine ?? new MemoryEngine(),
    ownsEngine: engine === undefined,
    windowMs,
    tag: `[throttle:${name ?? keyPrefix.replace(/:$/, '')}]`,
    logger,
  };
}

export class ThrottleWindow {
  readonly #options: ResolvedThrottleWindowOptions;
  readonly #timers: TimerRegistry;
  readonly #registry: KeyStateRegistry;
  readonly #scheduler: ThrottleScheduler;

  constructor(keyPrefix: string, options: ThrottleWindowOptions = {}) {
    const resolved = resolveThrottleWindowOptions(keyPrefix, options);
    const { engine, logger, tag, windowMs } = resolved;
    const timers = new TimerRegistry((error) =>
      logger.error(`${tag} timer callback failed`, {
        error: describeError(error),
      }),
    );
    const registry = new KeyStateRegistry({ timers, logger, tag });
    this.#options = resolved;
    this.#timers = timers;
    this.#registry = registry;
    this.#scheduler = new ThrottleScheduler({
      keyPrefix,
      windowMs,
      logger,
      tag,
      timers,
      registry,
      guard: new EngineGuard({ engine, logger, tag }),
    });
  }

  get activeCount(): number {
    return this.#registry.activeCount;
  }

  get pendingCount(): number {
    return this.#registry.pendingCount;
  }

  get keyCount(): number {
    return this.#registry.size;
  }

  get timerCount(): number {
    return this.#timers.size;
  }

  job<T>(key: string, fn: ThrottleJobFn<T>): ThrottleJob<T> {
    return new ThrottleJob(this.#scheduler, key, fn);
  }

  destroy(): void {
    if (this.#registry.destroyed) {
      return;
    }
    this.#registry.destroy();
    this.#timers.clearAll();
    if (this.#options.ownsEngine) {
      const { engine } = this.#options;
      invokeSafely(() => engine.clear());
    }
  }
}
