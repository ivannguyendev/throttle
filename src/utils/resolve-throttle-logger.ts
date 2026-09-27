import type { ThrottleLogger, ThrottleLogMeta } from '../throttle-types';
import { invokeSafely } from './invoke-safely';

type LogSink = (...args: unknown[]) => void;
type LogMethod = (message: string, meta?: ThrottleLogMeta) => void;

const ignoreLog = (): void => undefined;

const toLogMethod =
  (sink: LogSink): LogMethod =>
  (message, meta) =>
    meta === undefined ? sink(message) : sink(message, meta);

export const SILENT_LOGGER: ThrottleLogger = Object.freeze({
  debug: ignoreLog,
  info: ignoreLog,
  error: ignoreLog,
});

export function createConsoleLogger(): ThrottleLogger {
  return {
    debug: toLogMethod((...args) => console.debug(...args)),
    info: toLogMethod((...args) => console.info(...args)),
    error: toLogMethod((...args) => console.error(...args)),
  };
}

export function createSafeLogger(logger: ThrottleLogger): ThrottleLogger {
  return {
    debug: (message, meta) => invokeSafely(() => logger.debug(message, meta)),
    info: (message, meta) => invokeSafely(() => logger.info(message, meta)),
    error: (message, meta) => invokeSafely(() => logger.error(message, meta)),
  };
}

const isThrottleLogger = (value: unknown): value is ThrottleLogger =>
  typeof value === 'object' &&
  value !== null &&
  'debug' in value &&
  typeof value.debug === 'function' &&
  'info' in value &&
  typeof value.info === 'function' &&
  'error' in value &&
  typeof value.error === 'function';

export function resolveThrottleLogger(debug: unknown): ThrottleLogger {
  if (debug === undefined || debug === false) {
    return SILENT_LOGGER;
  }
  if (debug === true) {
    return createSafeLogger(createConsoleLogger());
  }
  if (isThrottleLogger(debug)) {
    return createSafeLogger(debug);
  }
  throw new TypeError(
    'ThrottleWindow options.debug must be a boolean or a logger with debug(), info() and error()',
  );
}
