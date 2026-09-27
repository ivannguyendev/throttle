import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { MemoryEngine } from '../../src/engines/memory-engine';

const setIfAbsent = (engine: MemoryEngine, key: string, ttlMs: number) =>
  engine.set(key, '1', { PX: ttlMs, NX: true });

test.serial(
  'set NX refuses a live key and succeeds again after expiry',
  async (t) => {
    const engine = new MemoryEngine();

    t.true(await setIfAbsent(engine, 'k', 30));
    t.false(await setIfAbsent(engine, 'k', 30));
    await delay(60);

    t.true(await setIfAbsent(engine, 'k', 30));
    await engine.clear();
  },
);

test('keys are independent', async (t) => {
  const engine = new MemoryEngine();

  t.true(await setIfAbsent(engine, 'a', 1000));
  t.true(await setIfAbsent(engine, 'b', 1000));
  t.false(await setIfAbsent(engine, 'a', 1000));
  t.is(engine.size, 2);
  await engine.clear();
});

test('get returns the stored value of a live key', async (t) => {
  const engine = new MemoryEngine();

  await engine.set('k', '1700000000000', { PX: 1000 });

  t.is(await engine.get('k'), '1700000000000');
  await engine.clear();
});

test('get returns null for an absent key without storing it', async (t) => {
  const engine = new MemoryEngine();

  t.is(await engine.get('missing'), null);
  t.is(engine.size, 0);
});

test('set without NX overwrites a live key and its value', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 1000);

  t.true(await engine.set('k', 'next', { PX: 1000 }));

  t.is(await engine.get('k'), 'next');
  await engine.clear();
});

test.serial('set without NX re-creates an expired key', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 20);
  await delay(50);

  await engine.set('k', '1', { PX: 1000 });

  t.false(await setIfAbsent(engine, 'k', 1000));
  t.is(await engine.get('k'), '1');
  await engine.clear();
});

test.serial('set restarts the expiry with the new duration', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 30);

  await engine.set('k', '1', { PX: 1000 });
  await delay(60);

  t.false(await setIfAbsent(engine, 'k', 30));
  await engine.clear();
});

test.serial('set can also shorten the expiry of a live key', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 1000);

  await engine.set('k', '1', { PX: 20 });
  await delay(50);

  t.true(await setIfAbsent(engine, 'k', 1000));
  await engine.clear();
});

test.serial(
  'get is null after expiry and drops the expired entry',
  async (t) => {
    const engine = new MemoryEngine();
    await setIfAbsent(engine, 'k', 20);
    await delay(50);
    t.is(engine.size, 1);

    t.is(await engine.get('k'), null);
    t.is(engine.size, 0);
  },
);

test('del removes a key so the next set NX wins', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 1000);

  await engine.del('k');
  await engine.del('missing');

  t.is(engine.size, 0);
  t.true(await setIfAbsent(engine, 'k', 1000));
  await engine.clear();
});

test.serial(
  'the sweeper removes expired entries without further calls',
  async (t) => {
    const engine = new MemoryEngine({ sweepIntervalMs: 20 });
    await setIfAbsent(engine, 'a', 10);
    await engine.set('b', '1', { PX: 10 });
    t.is(engine.size, 2);

    await delay(80);

    t.is(engine.size, 0);
  },
);

test.serial('the sweeper keeps keys that are still live', async (t) => {
  const engine = new MemoryEngine({ sweepIntervalMs: 20 });
  await setIfAbsent(engine, 'expiring', 10);
  await setIfAbsent(engine, 'active', 1000);

  await delay(80);

  t.is(engine.size, 1);
  t.false(await setIfAbsent(engine, 'active', 1000));
  await engine.clear();
});

test('clear removes every entry and the engine keeps working', async (t) => {
  const engine = new MemoryEngine();
  await setIfAbsent(engine, 'k', 1000);

  await engine.clear();

  t.is(engine.size, 0);
  t.true(await setIfAbsent(engine, 'k', 1000));
  t.is(engine.size, 1);
  await engine.clear();
});

for (const sweepIntervalMs of [0, -5, 1.5, Number.NaN, 2 ** 31]) {
  test(`rejects sweepIntervalMs ${String(sweepIntervalMs)}`, (t) => {
    t.throws(() => new MemoryEngine({ sweepIntervalMs }), {
      instanceOf: RangeError,
      message: /sweepIntervalMs/,
    });
  });
}
