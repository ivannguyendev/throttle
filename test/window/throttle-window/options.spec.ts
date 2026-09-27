import test from 'ava';
import { MemoryEngine } from '../../../src/engines/memory-engine';
import { SILENT_LOGGER } from '../../../src/utils/resolve-throttle-logger';
import type {
  ThrottleLogger,
  ThrottleWindowOptions,
} from '../../../src/throttle-types';
import { resolveThrottleWindowOptions } from '../../../src/window/throttle-window';
import { StubEngine } from '../../helpers/stub-engine';

const asOptions = (value: unknown): ThrottleWindowOptions =>
  value as ThrottleWindowOptions;

const asKeyPrefix = (value: unknown): string => value as string;

const healthyEngine = () =>
  new StubEngine((operation) =>
    Promise.resolve(operation === 'get' ? null : true),
  );

test('rejects a keyPrefix that is not a non-empty string', (t) => {
  for (const keyPrefix of [undefined, null, '', 42]) {
    t.throws(() => resolveThrottleWindowOptions(asKeyPrefix(keyPrefix)), {
      instanceOf: TypeError,
      message: /keyPrefix/,
    });
  }
});

test('rejects options that are not an object', (t) => {
  for (const options of [null, 'orders:', 42]) {
    t.throws(() => resolveThrottleWindowOptions('p:', asOptions(options)), {
      instanceOf: TypeError,
      message: /options/,
    });
  }
});

test('rejects an engine without get, set, del and clear', (t) => {
  const incomplete = { get: async () => null, set: async () => true };

  for (const engine of [incomplete, 'redis', null]) {
    t.throws(() => resolveThrottleWindowOptions('p:', asOptions({ engine })), {
      instanceOf: TypeError,
      message: /engine/,
    });
  }
});

for (const windowMs of [0, 1.5, 2 ** 31]) {
  test(`rejects windowMs ${String(windowMs)} with a RangeError`, (t) => {
    t.throws(() => resolveThrottleWindowOptions('p:', { windowMs }), {
      instanceOf: RangeError,
      message: /windowMs/,
    });
  });
}

test('rejects a debug option that is neither a boolean nor a logger', (t) => {
  const partialLogger = { debug: () => undefined, info: () => undefined };

  for (const debug of ['yes', 1, null, partialLogger]) {
    t.throws(() => resolveThrottleWindowOptions('p:', asOptions({ debug })), {
      instanceOf: TypeError,
      message: /debug/,
    });
  }
});

test('applies the defaults and owns a new MemoryEngine', (t) => {
  const resolved = resolveThrottleWindowOptions('orders:');

  t.like(resolved, {
    keyPrefix: 'orders:',
    ownsEngine: true,
    windowMs: 1000,
    tag: '[throttle:orders]',
  });
  t.true(resolved.engine instanceof MemoryEngine);
});

test('keeps the given values and does not own a given engine', (t) => {
  const engine = healthyEngine();

  const resolved = resolveThrottleWindowOptions('orders:', {
    engine,
    windowMs: 50,
    name: 'order-sync',
  });

  t.like(resolved, {
    keyPrefix: 'orders:',
    engine,
    ownsEngine: false,
    windowMs: 50,
    tag: '[throttle:order-sync]',
  });
});

test('the tag trims only one trailing colon from keyPrefix', (t) => {
  t.is(resolveThrottleWindowOptions('user:seen:').tag, '[throttle:user:seen]');
  t.is(resolveThrottleWindowOptions('plain').tag, '[throttle:plain]');
});

test('logging is silent unless debug is enabled', (t) => {
  t.is(resolveThrottleWindowOptions('p:').logger, SILENT_LOGGER);
  t.is(
    resolveThrottleWindowOptions('p:', { debug: false }).logger,
    SILENT_LOGGER,
  );
  t.not(
    resolveThrottleWindowOptions('p:', { debug: true }).logger,
    SILENT_LOGGER,
  );
});

test('wraps the debug logger so its failures never escape', (t) => {
  const messages: string[] = [];
  const logger: ThrottleLogger = {
    debug: (message) => {
      messages.push(message);
    },
    info: () => {
      throw new Error('info failed');
    },
    error: () => Promise.reject(new Error('error failed')),
  };

  const resolved = resolveThrottleWindowOptions('p:', { debug: logger });

  resolved.logger.debug('hello');
  t.notThrows(() => resolved.logger.info('boom'));
  t.notThrows(() => resolved.logger.error('boom'));
  t.deepEqual(messages, ['hello']);
});
