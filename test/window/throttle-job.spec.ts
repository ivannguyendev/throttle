import test from 'ava';
import {
  ThrottleJob,
  type ThrottleJobScheduler,
  WaitingThrottleJob,
} from '../../src/window/throttle-job';
import type { ThrottleJobFn } from '../../src/throttle-types';

type SchedulerCall =
  | ['schedule', string, ThrottleJobFn<unknown>]
  | ['scheduleAndWait', string, ThrottleJobFn<unknown>, number | undefined];

class RecordingScheduler implements ThrottleJobScheduler {
  readonly calls: SchedulerCall[] = [];

  async schedule<T>(key: string, fn: ThrottleJobFn<T>): Promise<boolean> {
    this.calls.push(['schedule', key, fn]);
    return true;
  }

  async scheduleAndWait<T>(
    key: string,
    fn: ThrottleJobFn<T>,
    timeoutMs?: number,
  ): Promise<T> {
    this.calls.push(['scheduleAndWait', key, fn, timeoutMs]);
    return fn('leading');
  }
}

const answer = (): number => 42;

test('rejects a key that is not a non-empty string', (t) => {
  const scheduler = new RecordingScheduler();

  for (const key of ['', 42, undefined]) {
    t.throws(
      () => new ThrottleJob(scheduler, key as unknown as string, answer),
      {
        instanceOf: TypeError,
      },
    );
  }
});

test('rejects a fn that is not a function', (t) => {
  const scheduler = new RecordingScheduler();
  const notAFunction = 'run' as unknown as ThrottleJobFn<number>;

  t.throws(() => new ThrottleJob(scheduler, 'k', notAFunction), {
    instanceOf: TypeError,
  });
});

test('exec delegates to schedule with the key and fn', async (t) => {
  const scheduler = new RecordingScheduler();

  t.true(await new ThrottleJob(scheduler, 'k', answer).exec());

  t.deepEqual(scheduler.calls, [['schedule', 'k', answer]]);
});

test('waitFinish().exec() delegates to scheduleAndWait without a timeout', async (t) => {
  const scheduler = new RecordingScheduler();
  const waiting = new ThrottleJob(scheduler, 'k', answer).waitFinish();

  t.true(waiting instanceof WaitingThrottleJob);
  t.is(await waiting.exec(), 42);
  t.deepEqual(scheduler.calls, [['scheduleAndWait', 'k', answer, undefined]]);
});

test('timeout returns a new job and leaves the original unchanged', async (t) => {
  const scheduler = new RecordingScheduler();
  const waiting = new ThrottleJob(scheduler, 'k', answer).waitFinish();

  const timed = waiting.timeout(50);
  await timed.exec();
  await waiting.exec();

  t.not(timed, waiting);
  t.true(timed instanceof WaitingThrottleJob);
  t.deepEqual(scheduler.calls, [
    ['scheduleAndWait', 'k', answer, 50],
    ['scheduleAndWait', 'k', answer, undefined],
  ]);
});

for (const timeoutMs of [0, 1.5, Number.POSITIVE_INFINITY]) {
  test(`timeout rejects ${String(timeoutMs)}`, (t) => {
    const waiting = new ThrottleJob(
      new RecordingScheduler(),
      'k',
      answer,
    ).waitFinish();

    t.throws(() => waiting.timeout(timeoutMs), {
      instanceOf: RangeError,
      message: /timeout/,
    });
  });
}

test('a plain ThrottleJob has no timeout method', (t) => {
  const job = new ThrottleJob(new RecordingScheduler(), 'k', answer);
  const hasTimeout: 'timeout' extends keyof ThrottleJob<number> ? true : false =
    false;

  t.false('timeout' in job);
  t.false(hasTimeout);
});
