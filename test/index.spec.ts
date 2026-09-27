import test from 'ava';
import * as publicApi from '../src/index';
import {
  MemoryEngine,
  type MemoryEngineOptions,
  type RedisClientLike,
  RedisEngine,
  type RedisEngineOptions,
  ThrottleDestroyedError,
  ThrottleDroppedError,
  type ThrottleEngine,
  ThrottleError,
  type ThrottleJobFn,
  type ThrottleLogger,
  type ThrottleLogMeta,
  type ThrottlePhase,
  ThrottleTimeoutError,
  ThrottleWindow,
  type ThrottleWindowOptions,
  WaitingThrottleJob,
} from '../src/index';
import { FakeRedisClient } from './helpers/fake-redis-client';
import { keepEventLoopAlive } from './helpers/keep-event-loop-alive';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

test('exports exactly the public runtime API', (t) => {
  t.deepEqual(Object.keys(publicApi).sort(), [
    'MemoryEngine',
    'RedisEngine',
    'ThrottleDestroyedError',
    'ThrottleDroppedError',
    'ThrottleError',
    'ThrottleJob',
    'ThrottleTimeoutError',
    'ThrottleWindow',
    'WaitingThrottleJob',
  ]);
  t.false('starter' in publicApi);
});

test('every exported error is a ThrottleError', (t) => {
  const errors = [
    new ThrottleTimeoutError('k', 10),
    new ThrottleDroppedError('k'),
    new ThrottleDestroyedError('k'),
  ];

  t.true(errors.every((error) => error instanceof ThrottleError));
});

test.serial(
  'end to end: leading, then trailing across two instances',
  async (t) => {
    const logged: ThrottleLogMeta[] = [];
    const logger: ThrottleLogger = {
      debug: () => undefined,
      info: () => undefined,
      error: (_message, meta) => {
        logged.push(meta ?? {});
      },
    };
    const client: RedisClientLike = new FakeRedisClient();
    const engineOptions: RedisEngineOptions = { client };
    const createWindow = (engine: ThrottleEngine) => {
      const options: ThrottleWindowOptions = {
        engine,
        windowMs: 30,
        debug: logger,
      };
      return new ThrottleWindow('smoke:', options);
    };
    const first = createWindow(new RedisEngine(engineOptions));
    const second = createWindow(new RedisEngine(engineOptions));
    t.teardown(() => {
      first.destroy();
      second.destroy();
    });
    const report: ThrottleJobFn<ThrottlePhase> = (phase) => phase;

    const leading = first.job('k', report).waitFinish();
    t.true(leading instanceof WaitingThrottleJob);
    t.is(await leading.exec(), 'leading');
    t.is(
      await second.job('k', report).waitFinish().timeout(1000).exec(),
      'trailing',
    );

    t.deepEqual(logged, []);
  },
);

test('MemoryEngine accepts its public options', async (t) => {
  const options: MemoryEngineOptions = { sweepIntervalMs: 1000 };
  const engine = new MemoryEngine(options);
  t.teardown(() => engine.clear());

  t.true(await engine.set('k', '1', { PX: 1000, NX: true }));
});
