import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisEngine } from '../../../src/engines/redis-engine';
import { createDeferred } from '../../helpers/create-deferred';
import { FakeRedisClient } from '../../helpers/fake-redis-client';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { createRedisWindow } from '../../helpers/redis-window-fixtures';
import { StubEngine, type StubEngineCall } from '../../helpers/stub-engine';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

test.serial(
  'no other instance can acquire the window during a long run',
  async (t) => {
    const client = new FakeRedisClient();
    const window = createRedisWindow(client, { windowMs: 50 });
    t.teardown(() => window.destroy());
    const otherInstance = new RedisEngine({ client });
    const started = createDeferred<void>();
    let running = true;
    let polls = 0;
    let wins = 0;

    const leading = window
      .job('k', async () => {
        started.resolve();
        await delay(300);
        running = false;
      })
      .exec();
    await started.promise;
    while (running) {
      polls += 1;
      if (await otherInstance.set('cluster:k', '1', { PX: 50, NX: true })) {
        wins += 1;
      }
      await delay(10);
    }

    t.true(await leading);
    t.is(wins, 0, `the other instance won ${wins} of ${polls} polls`);
    t.true(polls >= 15, `${polls} polls`);
  },
);

test.serial('the lease never has more than one extend in flight', async (t) => {
  const engine = new StubEngine((operation) => {
    if (operation === 'extend') {
      return new Promise<never>(() => undefined);
    }
    return Promise.resolve(operation === 'acquire' ? true : null);
  });
  const window = new ThrottleWindow('lease:', {
    engine,
    windowMs: 50,
  });
  t.teardown(() => window.destroy());
  const runFinished = createDeferred<StubEngineCall[]>();

  void window
    .job('k', async () => {
      await delay(350);
      runFinished.resolve(
        engine.calls.filter(({ intent }) => intent === 'extend'),
      );
    })
    .exec();
  const extendsDuringRun = await runFinished.promise;

  t.deepEqual(
    extendsDuringRun.map(({ args }) => [args[0], args[2]]),
    [['lease:k', { PX: 200 }]],
  );
});
