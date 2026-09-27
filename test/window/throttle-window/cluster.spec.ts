import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeRedisClient } from '../../helpers/fake-redis-client';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import {
  createRedisWindow,
  recordInstanceRuns,
} from '../../helpers/redis-window-fixtures';
import { waitFor } from '../../helpers/wait-for';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

test.serial('a failing Redis fails open so jobs still run', async (t) => {
  const client = new FakeRedisClient();
  client.mode = 'failing';
  const window = createRedisWindow(client);
  t.teardown(() => window.destroy());

  const value = await window
    .job('k', (phase) => phase)
    .waitFinish()
    .exec();

  t.is(value, 'leading');
  t.true(client.calls.length > 0);
});

test.serial(
  'with the breaker open a key still runs at most once per window',
  async (t) => {
    const client = new FakeRedisClient();
    client.mode = 'failing';
    const window = createRedisWindow(client);
    t.teardown(() => window.destroy());
    const { job, startedAt } = recordInstanceRuns();
    let callsAtHalfway = 0;

    for (let call = 0; call < 30; call += 1) {
      void window.job('k', job('only')).exec();
      await delay(10);
      if (call === 15) {
        callsAtHalfway = client.calls.length;
      }
    }
    await waitFor(() => window.keyCount === 0);

    const gaps = startedAt.slice(1).map((at, index) => at - startedAt[index]);
    t.true(
      startedAt.length >= 3 && startedAt.length <= 9,
      `${startedAt.length} runs`,
    );
    t.true(
      gaps.every((gap) => gap >= 40),
      `gaps ${gaps.join(', ')}`,
    );
    t.true(callsAtHalfway > 0);
    t.is(client.calls.length, callsAtHalfway);
  },
);

test.serial(
  'two instances sharing Redis run a key once per window between them',
  async (t) => {
    const client = new FakeRedisClient();
    const first = createRedisWindow(client);
    const second = createRedisWindow(client);
    t.teardown(() => {
      first.destroy();
      second.destroy();
    });
    const { job, runs, startedAt } = recordInstanceRuns();

    const results = await Promise.all([
      first.job('k', job('first')).exec(),
      second.job('k', job('second')).exec(),
    ]);
    await waitFor(() => runs.length === 2);
    await delay(120);

    const [leader, follower] = results[0]
      ? ['first', 'second']
      : ['second', 'first'];
    t.deepEqual([...results].sort(), [false, true]);
    t.deepEqual(runs, [
      [leader, 'leading'],
      [follower, 'trailing'],
    ]);
    const gapMs = (startedAt[1] ?? 0) - (startedAt[0] ?? 0);
    t.true(gapMs >= 45, `trailing ran ${gapMs}ms after the leading run`);
  },
);
