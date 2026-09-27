import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeRedisClient } from './fake-redis-client';

test('SET NX only writes a key that holds no live value', async (t) => {
  const client = new FakeRedisClient();

  t.is(await client.set('k', 'first', 'PX', 1000, 'NX'), 'OK');
  t.is(await client.set('k', 'second', 'PX', 1000, 'NX'), null);
  t.is(await client.get('k'), 'first');
});

test('SET without NX overwrites the key, its value and its expiry', async (t) => {
  const client = new FakeRedisClient();
  await client.set('k', 'first', 'PX', 1000, 'NX');

  t.is(await client.set('k', 'second', 'PX', 50_000), 'OK');
  t.is(await client.get('k'), 'second');
  t.true((client.peekRemainingMs('k') ?? 0) > 1000);
});

test.serial('keys expire after their PX duration', async (t) => {
  const client = new FakeRedisClient();
  await client.set('k', '1', 'PX', 20, 'NX');
  await delay(50);

  t.is(await client.get('k'), null);
  t.is(client.peekRemainingMs('k'), undefined);
  t.is(await client.set('k', '1', 'PX', 20, 'NX'), 'OK');
});

test('DEL removes a live key and reports how many were removed', async (t) => {
  const client = new FakeRedisClient();
  await client.set('k', '1', 'PX', 1000);

  t.is(await client.del('k'), 1);
  t.is(await client.del('k'), 0);
  t.is(await client.get('k'), null);
});

test('rejects a PX that is not a positive integer, like Redis', async (t) => {
  const client = new FakeRedisClient();

  await t.throwsAsync(client.set('k', '1', 'PX', 0), { message: /expire/ });
  await t.throwsAsync(client.set('k', '1', 'PX', 1.5, 'NX'), {
    message: /expire/,
  });
  t.is(await client.get('k'), null);
});

test('records every command with its exact arguments', async (t) => {
  const client = new FakeRedisClient();

  await client.set('k', '1', 'PX', 100, 'NX');
  await client.set('k', '1', 'PX', 100);
  await client.get('k');
  await client.del('k');

  t.deepEqual(client.calls, [
    { command: 'set', args: ['k', '1', 'PX', 100, 'NX'] },
    { command: 'set', args: ['k', '1', 'PX', 100] },
    { command: 'get', args: ['k'] },
    { command: 'del', args: ['k'] },
  ]);
});

test('answers asynchronously even without latency', async (t) => {
  const client = new FakeRedisClient();
  let settled = false;

  const answer = client.get('k').then(() => {
    settled = true;
  });
  await Promise.resolve();
  t.false(settled);
  await answer;

  t.true(settled);
});

test('failing mode rejects commands without applying them', async (t) => {
  const client = new FakeRedisClient();
  client.mode = 'failing';

  await t.throwsAsync(client.set('k', '1', 'PX', 100, 'NX'), {
    message: 'fake redis failure',
  });
  await t.throwsAsync(client.get('k'), { message: 'fake redis failure' });
  t.is(client.calls.length, 2);
  t.is(client.inFlight, 0);

  client.mode = 'normal';
  t.is(await client.get('k'), null);
});

test.serial('hanging commands never settle and stay in flight', async (t) => {
  const client = new FakeRedisClient();
  client.mode = 'hanging';
  let settledCount = 0;
  const countSettled = (): void => {
    settledCount += 1;
  };

  void client.set('k', '1', 'PX', 100, 'NX').finally(countSettled);
  void client.get('k').finally(countSettled);
  await delay(30);

  t.is(settledCount, 0);
  t.is(client.inFlight, 2);
  client.mode = 'normal';
  t.is(await client.get('k'), null);
  t.is(client.inFlight, 2);
  t.is(client.maxInFlight, 3);
});

test.serial('latencyMs delays answers of concurrent commands', async (t) => {
  const client = new FakeRedisClient();
  client.latencyMs = 40;
  const startedAt = performance.now();

  const answers = Promise.all([
    client.set('a', '1', 'PX', 1000, 'NX'),
    client.get('b'),
    client.get('c'),
  ]);
  t.is(client.inFlight, 3);
  await answers;

  t.true(performance.now() - startedAt >= 35);
  t.is(client.inFlight, 0);
  t.is(client.maxInFlight, 3);
});
