import test from 'ava';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { waitForEachTurn } from '../../helpers/wait-for';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const ITERATIONS = 20;

test.serial('a call made right after an idle close always leads', async (t) => {
  const window = new ThrottleWindow('idle:', { windowMs: 20 });
  t.teardown(() => window.destroy());
  const results: boolean[] = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    results.push(await window.job('k', () => iteration).exec());
    await waitForEachTurn(() => window.keyCount === 0);
  }

  t.deepEqual(
    results,
    Array.from({ length: ITERATIONS }, () => true),
  );
});
