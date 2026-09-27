import test from 'ava';
import {
  createConsoleLogger,
  createSafeLogger,
  resolveThrottleLogger,
  SILENT_LOGGER,
} from '../../src/utils/resolve-throttle-logger';
import type { ThrottleLogger, ThrottleLogMeta } from '../../src/throttle-types';
import { captureUnhandledRejections } from '../helpers/capture-unhandled-rejections';
import { createRecordingLogger } from '../helpers/recording-logger';

type LoggerMethod = keyof ThrottleLogger;
type ConsoleMethod = 'debug' | 'info' | 'error';

const loggerMethods: LoggerMethod[] = ['debug', 'info', 'error'];

const createFailingLogger = (
  fail: (method: LoggerMethod) => unknown,
): ThrottleLogger => ({
  debug: () => fail('debug'),
  info: () => fail('info'),
  error: () => fail('error'),
});

const throwingLogger = createFailingLogger((method) => {
  throw new Error(`${method} failed`);
});

const rejectingLogger = createFailingLogger(async (method) => {
  throw new Error(`${method} rejected`);
});

const captureConsole = (run: () => void): Array<[ConsoleMethod, unknown[]]> => {
  const calls: Array<[ConsoleMethod, unknown[]]> = [];
  const originals = {
    debug: console.debug,
    info: console.info,
    error: console.error,
  };
  for (const method of loggerMethods) {
    console[method] = (...args: unknown[]) => {
      calls.push([method, args]);
    };
  }
  try {
    run();
  } finally {
    Object.assign(console, originals);
  }
  return calls;
};

for (const method of loggerMethods) {
  test(`createSafeLogger swallows errors thrown by ${method}`, (t) => {
    const safeLogger = createSafeLogger(throwingLogger);

    t.notThrows(() => safeLogger[method]('message', { key: 'a' }));
  });

  test.serial(
    `createSafeLogger absorbs async rejections from ${method}`,
    async (t) => {
      const safeLogger = createSafeLogger(rejectingLogger);

      const unhandledReasons = await captureUnhandledRejections(() =>
        safeLogger[method]('message', { key: 'a' }),
      );

      t.deepEqual(unhandledReasons, []);
    },
  );

  test(`createSafeLogger forwards ${method} arguments`, (t) => {
    const { entries, logger } = createRecordingLogger();

    createSafeLogger(logger)[method]('message', { key: 'a' });

    t.deepEqual(entries, [[method, 'message', { key: 'a' }]]);
  });
}

test('createSafeLogger keeps the logger instance bound to its methods', (t) => {
  class PrefixedLogger implements ThrottleLogger {
    readonly lines: string[] = [];
    constructor(private readonly prefix: string) {}
    debug(message: string): void {
      this.lines.push(`${this.prefix} ${message}`);
    }
    info(message: string): void {
      this.debug(message);
    }
    error(message: string): void {
      this.debug(message);
    }
  }
  const logger = new PrefixedLogger('[app]');

  createSafeLogger(logger).info('ready');

  t.deepEqual(logger.lines, ['[app] ready']);
});

test.serial('SILENT_LOGGER writes nothing to the console', (t) => {
  const calls = captureConsole(() => {
    for (const method of loggerMethods) {
      SILENT_LOGGER[method]('message', { key: 'a' });
    }
  });

  t.deepEqual(calls, []);
});

test.serial(
  'createConsoleLogger routes each level to its console method',
  (t) => {
    const meta: ThrottleLogMeta = { key: 'a' };

    const calls = captureConsole(() => {
      const logger = createConsoleLogger();
      logger.debug('debug message', meta);
      logger.info('info message');
      logger.error('error message', meta);
    });

    t.deepEqual(calls, [
      ['debug', ['debug message', meta]],
      ['info', ['info message']],
      ['error', ['error message', meta]],
    ]);
  },
);

test('resolveThrottleLogger is silent when debug is off', (t) => {
  t.is(resolveThrottleLogger(undefined), SILENT_LOGGER);
  t.is(resolveThrottleLogger(false), SILENT_LOGGER);
});

test.serial(
  'resolveThrottleLogger writes to the console when debug is true',
  (t) => {
    const calls = captureConsole(() =>
      resolveThrottleLogger(true).info('hello'),
    );

    t.deepEqual(calls, [['info', ['hello']]]);
  },
);

test('resolveThrottleLogger forwards to a given logger safely', (t) => {
  const { entries, logger } = createRecordingLogger();

  const resolved = resolveThrottleLogger(logger);
  resolved.error('boom', { key: 'k' });

  t.deepEqual(entries, [['error', 'boom', { key: 'k' }]]);
  t.notThrows(() => resolveThrottleLogger(throwingLogger).debug('boom'));
});

test('resolveThrottleLogger rejects anything else with a TypeError', (t) => {
  for (const debug of [null, 'yes', 0, {}, { debug: () => undefined }]) {
    t.throws(() => resolveThrottleLogger(debug), {
      instanceOf: TypeError,
      message: /debug/,
    });
  }
});
