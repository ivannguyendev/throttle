import test from 'ava';
import { captureUnhandledRejections } from '../../helpers/capture-unhandled-rejections';
import { keepEventLoopAlive } from '../../helpers/keep-event-loop-alive';
import { createRecordingLogger } from '../../helpers/recording-logger';
import { waitFor } from '../../helpers/wait-for';
import type {
  ThrottleLogger,
  ThrottleWindowOptions,
} from '../../../src/throttle-types';
import { ThrottleWindow } from '../../../src/window/throttle-window';

const releaseEventLoop = keepEventLoopAlive();

test.after.always(releaseEventLoop);

const createWindow = (overrides: Partial<ThrottleWindowOptions> = {}) =>
  new ThrottleWindow('errors:', {
    windowMs: 30,
    ...overrides,
  });

const failWith = (failure: Error) => (): never => {
  throw failure;
};

const expectTrailingFailureThenRecovery = async (
  window: ThrottleWindow,
): Promise<string> => {
  await window.job('k', () => 'ok').exec();
  const failure = new Error('trailing failed');
  await window
    .job('k', failWith(failure))
    .waitFinish()
    .exec()
    .catch(() => '');
  return window
    .job('k', () => 'recovered')
    .waitFinish()
    .timeout(1000)
    .exec();
};

test.serial(
  'a failing leading run rejects exec once and logs no error',
  async (t) => {
    const { entries, logger } = createRecordingLogger();
    const window = createWindow({ debug: logger });
    t.teardown(() => window.destroy());
    const failure = new Error('leading failed');

    const reasons = await captureUnhandledRejections(async () => {
      await t.throwsAsync(window.job('k', failWith(failure)).exec(), {
        is: failure,
      });
    });

    t.deepEqual(reasons, []);
    t.deepEqual(
      entries.filter(([level]) => level === 'error'),
      [],
    );
  },
);

test.serial(
  'a failing leading run rejects the waiting leader once',
  async (t) => {
    const window = createWindow();
    t.teardown(() => window.destroy());
    const failure = new Error('leading failed');

    const reasons = await captureUnhandledRejections(async () => {
      const waiting = window.job('k', failWith(failure)).waitFinish().exec();
      await t.throwsAsync(waiting, { is: failure });
    });

    t.deepEqual(reasons, []);
  },
);

test.serial(
  'a failing trailing run rejects its waiters and logs one error',
  async (t) => {
    const { entries, logger } = createRecordingLogger();
    const window = createWindow({ debug: logger });
    t.teardown(() => window.destroy());
    const failure = new Error('trailing failed');
    await window.job('k', () => 'ok').exec();

    const waiters = [
      window.job('k', failWith(failure)).waitFinish().exec(),
      window.job('k', failWith(failure)).waitFinish().exec(),
    ];

    for (const waiter of waiters) {
      await t.throwsAsync(waiter, { is: failure });
    }
    t.deepEqual(
      entries.filter(([level]) => level === 'error'),
      [
        [
          'error',
          '[throttle:errors] trailing run failed',
          { key: 'k', phase: 'trailing', error: 'trailing failed' },
        ],
      ],
    );
  },
);

test.serial('a failing trailing run behind exec() is logged', async (t) => {
  const { entries, logger } = createRecordingLogger();
  const window = createWindow({ debug: logger });
  t.teardown(() => window.destroy());
  await window.job('k', () => 'ok').exec();

  t.false(await window.job('k', failWith(new Error('trailing failed'))).exec());
  await waitFor(() => entries.some(([level]) => level === 'error'));

  t.deepEqual(
    entries.filter(([level]) => level === 'error'),
    [
      [
        'error',
        '[throttle:errors] trailing run failed',
        { key: 'k', phase: 'trailing', error: 'trailing failed' },
      ],
    ],
  );
});

test.serial('the debug logger receives every run at info level', async (t) => {
  const { entries, logger } = createRecordingLogger();
  const window = createWindow({ debug: logger });
  t.teardown(() => window.destroy());

  await window.job('k', () => 'leading').exec();
  await window
    .job('k', () => 'trailing')
    .waitFinish()
    .timeout(1000)
    .exec();

  t.deepEqual(
    entries.filter(([level]) => level === 'info'),
    [
      ['info', '[throttle:errors] run', { key: 'k', phase: 'leading' }],
      ['info', '[throttle:errors] run', { key: 'k', phase: 'trailing' }],
    ],
  );
});

test.serial(
  'without debug a failing trailing run writes nothing to the console',
  async (t) => {
    const window = createWindow();
    t.teardown(() => window.destroy());
    const originalError = console.error;
    const written: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      written.push(args);
    };

    try {
      t.is(await expectTrailingFailureThenRecovery(window), 'recovered');
    } finally {
      console.error = originalError;
    }

    t.deepEqual(written, []);
  },
);

test.serial('a throwing logger does not wedge the key', async (t) => {
  const fail = (): never => {
    throw new Error('logger failed');
  };
  const logger: ThrottleLogger = { debug: fail, info: fail, error: fail };
  const window = createWindow({ debug: logger });
  t.teardown(() => window.destroy());

  t.is(await expectTrailingFailureThenRecovery(window), 'recovered');
});
