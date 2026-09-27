import test from 'ava';
import { createDeferred } from '../../helpers/create-deferred';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { waitFor } from '../../helpers/wait-for';
import type { ThrottlePhase } from '../../../src/throttle-types';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const CALLS = 10_000;

test.serial(
  '10_000 calls in one tick during the leading run give one leading and one trailing run',
  async (t) => {
    const window = new ThrottleWindow('stress:', { windowMs: 30 });
    t.teardown(() => window.destroy());
    const phases: ThrottlePhase[] = [];
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const job = async (phase: ThrottlePhase): Promise<ThrottlePhase> => {
      phases.push(phase);
      if (phase === 'leading') {
        started.resolve();
        await release.promise;
      }
      return phase;
    };

    const leading = window.job('k', job).exec();
    await started.promise;
    const burst = Array.from({ length: CALLS }, (_, index) =>
      index % 2 === 0
        ? window.job('k', job).exec()
        : window.job('k', job).waitFinish().exec(),
    );
    release.resolve();

    t.true(await leading);
    const settled = await Promise.all(burst);
    await waitFor(() => window.keyCount === 0, 2000);

    t.deepEqual(phases, ['leading', 'trailing']);
    t.true(
      settled.every((value, index) =>
        index % 2 === 0 ? value === false : value === 'trailing',
      ),
    );
  },
);

test.serial(
  '10_000 calls in one tick before the acquire settles share the leading run',
  async (t) => {
    const window = new ThrottleWindow('stress:', { windowMs: 30 });
    t.teardown(() => window.destroy());
    const phases: ThrottlePhase[] = [];
    const job = (phase: ThrottlePhase): void => {
      phases.push(phase);
    };

    const results = await Promise.all(
      Array.from({ length: CALLS }, () => window.job('k', job).exec()),
    );
    await waitFor(() => window.keyCount === 0, 2000);

    t.true(results[0]);
    t.is(results.filter(Boolean).length, 1);
    t.deepEqual(phases, ['leading']);
  },
);

test.serial(
  '10_000 distinct keys each run once and then leave nothing behind',
  async (t) => {
    const window = new ThrottleWindow('stress:', { windowMs: 50 });
    t.teardown(() => window.destroy());
    const runsByKey = new Map<string, number>();

    const results = await Promise.all(
      Array.from({ length: CALLS }, (_, index) => {
        const key = `key-${index}`;
        return window
          .job(key, () => {
            runsByKey.set(key, (runsByKey.get(key) ?? 0) + 1);
          })
          .exec();
      }),
    );
    await waitFor(() => window.keyCount === 0 && window.timerCount === 0, 5000);

    t.true(results.every(Boolean));
    t.is(runsByKey.size, CALLS);
    t.true([...runsByKey.values()].every((runs) => runs === 1));
  },
);
