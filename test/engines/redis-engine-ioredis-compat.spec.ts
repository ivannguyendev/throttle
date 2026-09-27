import test from 'ava';
import { Redis } from 'ioredis';
import { Redis as Redis5 } from 'ioredis5';
import {
  RedisEngine,
  type RedisClientLike,
} from '../../src/engines/redis-engine';

test('an ioredis 6 client is a RedisClientLike', (t) => {
  const client = new Redis({ lazyConnect: true });

  const typed: RedisClientLike = client;
  const engine = new RedisEngine({ client });

  t.true(engine instanceof RedisEngine);
  t.is(typed, client);
  client.disconnect();
});

test('an ioredis 6 client with resp3 reply mapping is a RedisClientLike', (t) => {
  const client = new Redis({ lazyConnect: true, replyMapping: 'resp3' });

  const typed: RedisClientLike = client;
  const engine = new RedisEngine({ client });

  t.true(engine instanceof RedisEngine);
  t.is(typed, client);
  client.disconnect();
});

test('an ioredis 5 client is a RedisClientLike', (t) => {
  const client = new Redis5({ lazyConnect: true });

  const typed: RedisClientLike = client;
  const engine = new RedisEngine({ client });

  t.true(engine instanceof RedisEngine);
  t.is(typed, client);
  client.disconnect();
});
