import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeRedisClient } from '../helpers/fake-redis-client';
import {
  RedisEngine,
  type RedisEngineOptions,
} from '../../src/engines/redis-engine';

const createEngine = () => {
  const client = new FakeRedisClient();
  return { client, engine: new RedisEngine({ client }) };
};

test('set with NX sends SET key value PX ms NX', async (t) => {
  const { client, engine } = createEngine();

  t.true(await engine.set('k', 'v', { PX: 100, NX: true }));

  t.deepEqual(client.calls, [
    { command: 'set', args: ['k', 'v', 'PX', 100, 'NX'] },
  ]);
});

test('set without NX sends SET key value PX ms', async (t) => {
  const { client, engine } = createEngine();

  t.true(await engine.set('k', 'v', { PX: 100 }));

  t.deepEqual(client.calls, [{ command: 'set', args: ['k', 'v', 'PX', 100] }]);
});

test('get sends GET key and returns the stored value', async (t) => {
  const { client, engine } = createEngine();
  await engine.set('k', 'v', { PX: 1000 });

  t.is(await engine.get('k'), 'v');
  t.is(await engine.get('missing'), null);
  t.deepEqual(client.calls.slice(1), [
    { command: 'get', args: ['k'] },
    { command: 'get', args: ['missing'] },
  ]);
});

test('del sends DEL key', async (t) => {
  const { client, engine } = createEngine();
  await engine.set('k', 'v', { PX: 1000 });

  await engine.del('k');

  t.deepEqual(client.calls.at(-1), { command: 'del', args: ['k'] });
  t.is(await engine.get('k'), null);
});

test('clear sends no command because keys expire on their own', async (t) => {
  const { client, engine } = createEngine();
  await engine.set('k', 'v', { PX: 1000 });

  await engine.clear();

  t.is(client.calls.length, 1);
  t.is(await engine.get('k'), 'v');
});

test.serial('set NX wins only while no key is live', async (t) => {
  const { engine } = createEngine();

  t.true(await engine.set('k', '1', { PX: 30, NX: true }));
  t.false(await engine.set('k', '1', { PX: 30, NX: true }));
  await delay(60);

  t.true(await engine.set('k', '1', { PX: 30, NX: true }));
});

test.serial('set without NX re-creates an expired key', async (t) => {
  const { client, engine } = createEngine();
  await engine.set('k', '1', { PX: 20, NX: true });
  await delay(50);

  await engine.set('k', '1', { PX: 1000 });

  t.false(await engine.set('k', '1', { PX: 1000, NX: true }));
  t.true((client.peekRemainingMs('k') ?? 0) > 500);
});

test('engines sharing one client share their keys', async (t) => {
  const client = new FakeRedisClient();
  const first = new RedisEngine({ client });
  const second = new RedisEngine({ client });

  t.true(await first.set('k', 'v', { PX: 1000, NX: true }));
  t.false(await second.set('k', 'v', { PX: 1000, NX: true }));
  t.is(await second.get('k'), 'v');
});

test('every operation rejects when the client fails', async (t) => {
  const { client, engine } = createEngine();
  client.mode = 'failing';
  const failure = { message: 'fake redis failure' };

  await t.throwsAsync(engine.set('k', 'v', { PX: 100, NX: true }), failure);
  await t.throwsAsync(engine.set('k', 'v', { PX: 100 }), failure);
  await t.throwsAsync(engine.get('k'), failure);
  await t.throwsAsync(engine.del('k'), failure);
});

const invalidOptions: Array<[string, unknown]> = [
  ['missing options', undefined],
  ['null options', null],
  ['a missing client', {}],
  ['a null client', { client: null }],
  [
    'a client without del',
    { client: { set: async () => 'OK', get: async () => null } },
  ],
  [
    'a client whose set is not a function',
    { client: { set: 'OK', get: async () => null, del: async () => 0 } },
  ],
];

for (const [label, options] of invalidOptions) {
  test(`constructor throws a TypeError for ${label}`, (t) => {
    t.throws(() => new RedisEngine(options as RedisEngineOptions), {
      instanceOf: TypeError,
      message: /client/,
    });
  });
}
