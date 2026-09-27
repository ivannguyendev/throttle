import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EngineGuard,
  type EngineGuardOptions,
} from '../../src/scheduler/engine-guard';
import { SILENT_LOGGER } from '../../src/utils/resolve-throttle-logger';
import { keepEventLoopAlive } from '../helpers/keep-event-loop-alive';
import {
  StubEngine,
  type StubEngineIntent,
  type StubEngineResponder,
} from '../helpers/stub-engine';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const NOW_MS = 1_000;
const WINDOW = { fallbackMs: 100, maxMs: 1000 };

const createGuard = (
  respond: StubEngineResponder,
  overrides: Partial<EngineGuardOptions> = {},
) => {
  const engine = new StubEngine(respond);
  const guard = new EngineGuard({
    engine,
    logger: SILENT_LOGGER,
    tag: '[throttle:test]',
    clock: () => NOW_MS,
    ...overrides,
  });
  return { engine, guard };
};

const resolveWith =
  (results: Partial<Record<StubEngineIntent, unknown>>) =>
  (intent: StubEngineIntent): Promise<unknown> =>
    Promise.resolve(results[intent]);

test('writes the window expiry through set and reads it through get', async (t) => {
  const { engine, guard } = createGuard(
    resolveWith({ acquire: true, extend: true, get: '1042' }),
  );

  t.true(await guard.acquire('k', 100));
  await guard.extend('k', 200);
  t.is(await guard.remaining('k', WINDOW), 42);

  t.deepEqual(engine.calls, [
    {
      operation: 'set',
      intent: 'acquire',
      args: ['k', '1100', { PX: 100, NX: true }],
    },
    { operation: 'set', intent: 'extend', args: ['k', '1200', { PX: 200 }] },
    { operation: 'get', intent: 'get', args: ['k'] },
  ]);
  t.false(guard.isOpen);
});

test('acquire reports a key held elsewhere as false', async (t) => {
  const { guard } = createGuard(resolveWith({ acquire: false }));

  t.false(await guard.acquire('k', 100));
});

test('acquire treats any result other than true as refused', async (t) => {
  const { guard } = createGuard(resolveWith({ acquire: 'OK' }));

  t.false(await guard.acquire('k', 100));
});

test('accepts an engine that returns plain values', async (t) => {
  const { guard } = createGuard((intent) =>
    intent === 'acquire' ? true : '1007',
  );

  t.true(await guard.acquire('k', 100));
  t.is(await guard.remaining('k', WINDOW), 7);
});

const failingEngines: Array<[string, StubEngineResponder]> = [
  ['rejects', () => Promise.reject(new Error('engine down'))],
  [
    'throws synchronously',
    () => {
      throw new Error('engine exploded');
    },
  ],
];

for (const [label, respond] of failingEngines) {
  test(`fails open when the engine ${label}`, async (t) => {
    const { guard } = createGuard(respond);

    t.true(await guard.acquire('k', 100));
    await t.notThrowsAsync(guard.extend('k', 100));
    t.is(await guard.remaining('k', WINDOW), 100);
  });
}

test('remaining is 0 when the key is gone', async (t) => {
  const { guard } = createGuard(resolveWith({ get: null }));

  t.is(await guard.remaining('k', WINDOW), 0);
});

test('remaining is 0 when the stored expiry has passed', async (t) => {
  const { guard } = createGuard(resolveWith({ get: '900' }));

  t.is(await guard.remaining('k', WINDOW), 0);
});

test('remaining is capped at maxMs to bound clock skew', async (t) => {
  const { guard } = createGuard(resolveWith({ get: '99000' }));

  t.is(await guard.remaining('k', WINDOW), 1000);
});

for (const value of [undefined, 1042, '', '   ', 'x', 'Infinity', {}]) {
  test(`remaining falls back to fallbackMs for ${JSON.stringify(value) ?? 'undefined'}`, async (t) => {
    const { guard } = createGuard(resolveWith({ get: value }));

    t.is(await guard.remaining('k', WINDOW), 100);
  });
}

test.serial(
  'a hung engine call stays pending because there is no timeout',
  async (t) => {
    const { guard } = createGuard(() => new Promise<never>(() => undefined));

    const outcome = await Promise.race([
      guard.acquire('k', 100).then(() => 'settled'),
      delay(50, 'pending'),
    ]);

    t.is(outcome, 'pending');
  },
);
