import test from 'ava';
import { invokeSafely } from '../../src/utils/invoke-safely';
import { captureUnhandledRejections } from '../helpers/capture-unhandled-rejections';

test('invokeSafely runs the callback', (t) => {
  let calls = 0;

  invokeSafely(() => {
    calls += 1;
  });

  t.is(calls, 1);
});

test('invokeSafely swallows a thrown error', (t) => {
  t.notThrows(() =>
    invokeSafely(() => {
      throw new Error('callback failed');
    }),
  );
});

test.serial('invokeSafely absorbs a rejecting async callback', async (t) => {
  const unhandledReasons = await captureUnhandledRejections(() =>
    invokeSafely(async () => {
      throw new Error('async callback failed');
    }),
  );

  t.deepEqual(unhandledReasons, []);
});
