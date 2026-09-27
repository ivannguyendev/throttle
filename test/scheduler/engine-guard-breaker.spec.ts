import test from 'ava';
import {
  EngineGuard,
  type EngineGuardOptions,
} from '../../src/scheduler/engine-guard';
import { captureUnhandledRejections } from '../helpers/capture-unhandled-rejections';
import { keepEventLoopAlive } from '../helpers/keep-event-loop-alive';
import { StubEngine, type StubEngineResponder } from '../helpers/stub-engine';
import type { ThrottleLogger, ThrottleLogMeta } from '../../src/throttle-types';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

type DebugCall = [string, ThrottleLogMeta | undefined];

const createLogger = (debug: ThrottleLogger['debug']): ThrottleLogger => ({
  debug,
  info: () => undefined,
  error: () => undefined,
});

const createRecordingLogger = () => {
  const debugCalls: DebugCall[] = [];
  const logger = createLogger((message, meta) => {
    debugCalls.push([message, meta]);
  });
  return { debugCalls, logger };
};

const WINDOW = { fallbackMs: 100, maxMs: 1000 };

const engineDown: StubEngineResponder = () =>
  Promise.reject(new Error('engine down'));

const engineHealthy: StubEngineResponder = (operation) =>
  Promise.resolve(operation === 'get' ? '42' : operation === 'acquire');

const createBreakerGuard = (
  respond: StubEngineResponder,
  logger: ThrottleLogger = createRecordingLogger().logger,
  overrides: Partial<EngineGuardOptions> = {},
) => {
  const clock = { now: 0 };
  const engine = new StubEngine(respond);
  const guard = new EngineGuard({
    engine,
    logger,
    tag: '[throttle:test]',
    failureThreshold: 3,
    cooldownMs: 1000,
    now: () => clock.now,
    clock: () => 0,
    ...overrides,
  });
  return { clock, engine, guard };
};

const failThreeTimes = async (guard: EngineGuard): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await guard.acquire('k', 100);
  }
};

test('an open breaker skips the engine and fails open at once', async (t) => {
  const { engine, guard } = createBreakerGuard(engineDown);
  await failThreeTimes(guard);
  t.is(engine.calls.length, 3);
  t.true(guard.isOpen);

  const results = Promise.all([
    guard.acquire('k', 100),
    guard.extend('k', 100),
    guard.remaining('k', WINDOW),
  ]);

  t.deepEqual(await results, [true, undefined, 100]);
  t.is(engine.calls.length, 3);
});

test('logs the opening once with its context', async (t) => {
  const { debugCalls, logger } = createRecordingLogger();
  const { guard } = createBreakerGuard(engineDown, logger);

  await failThreeTimes(guard);
  await guard.acquire('k', 100);

  t.deepEqual(debugCalls, [
    [
      '[throttle:test] engine breaker open',
      { op: 'acquire', key: 'k', cooldownMs: 1000, error: 'engine down' },
    ],
  ]);
});

test('after the cooldown one probe reaches the engine and closes it', async (t) => {
  const { clock, engine, guard } = createBreakerGuard(engineDown);
  await failThreeTimes(guard);
  clock.now = 1000;
  engine.respond = engineHealthy;

  const probe = guard.acquire('k', 100);
  const skipped = guard.remaining('k', WINDOW);

  t.deepEqual(await Promise.all([probe, skipped]), [true, 100]);
  t.is(engine.calls.length, 4);
  t.false(guard.isOpen);
  t.is(await guard.remaining('k', WINDOW), 42);
  t.is(engine.calls.length, 5);
});

test('a failed probe re-opens the breaker and logs again', async (t) => {
  const { debugCalls, logger } = createRecordingLogger();
  const { clock, engine, guard } = createBreakerGuard(engineDown, logger);
  await failThreeTimes(guard);
  clock.now = 1000;

  t.is(await guard.remaining('k', WINDOW), 100);

  t.is(engine.calls.length, 4);
  t.true(guard.isOpen);
  t.is(debugCalls.length, 2);
  t.is(debugCalls[1]?.[1]?.op, 'remaining');
  t.true(await guard.acquire('k', 100));
  t.is(engine.calls.length, 4);
});

test('a throwing logger never breaks the guard', async (t) => {
  const logger = createLogger(() => {
    throw new Error('logger down');
  });
  const { guard } = createBreakerGuard(engineDown, logger);

  await t.notThrowsAsync(failThreeTimes(guard));

  t.true(guard.isOpen);
  t.true(await guard.acquire('k', 100));
});

test.serial('a rejecting logger leaves no unhandled rejection', async (t) => {
  const logger = createLogger(async () => {
    throw new Error('logger down');
  });
  const { guard } = createBreakerGuard(engineDown, logger);

  const reasons = await captureUnhandledRejections(() => failThreeTimes(guard));

  t.deepEqual(reasons, []);
  t.true(guard.isOpen);
});

test('fails open and logs when the engine rejects a non-Error', async (t) => {
  const { debugCalls, logger } = createRecordingLogger();
  const { guard } = createBreakerGuard(
    () => Promise.reject(Object.create(null)),
    logger,
    { failureThreshold: 1 },
  );

  t.true(await guard.acquire('k', 100));

  t.is(debugCalls.length, 1);
  t.is(typeof debugCalls[0]?.[1]?.error, 'string');
});
