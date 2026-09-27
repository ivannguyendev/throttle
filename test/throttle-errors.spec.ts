import test from 'ava';
import {
  ThrottleDestroyedError,
  ThrottleDroppedError,
  ThrottleError,
  ThrottleTimeoutError,
} from '../src/throttle-errors';

test('ThrottleError is an Error that carries the key and its class name', (t) => {
  const error = new ThrottleError('something failed', 'user:1');

  t.true(error instanceof Error);
  t.is(error.name, 'ThrottleError');
  t.is(error.key, 'user:1');
  t.is(error.message, 'something failed');
});

test('ThrottleTimeoutError exposes timeoutMs and says the job did not finish', (t) => {
  const error = new ThrottleTimeoutError('user:1', 200);

  t.true(error instanceof ThrottleTimeoutError);
  t.true(error instanceof ThrottleError);
  t.true(error instanceof Error);
  t.is(error.name, 'ThrottleTimeoutError');
  t.is(error.key, 'user:1');
  t.is(error.timeoutMs, 200);
  t.is(
    error.message,
    'Throttle job for key "user:1" did not finish within 200ms',
  );
});

const keyOnlyErrorCases = [
  { ErrorClass: ThrottleDroppedError, expectedName: 'ThrottleDroppedError' },
  {
    ErrorClass: ThrottleDestroyedError,
    expectedName: 'ThrottleDestroyedError',
  },
];

for (const { ErrorClass, expectedName } of keyOnlyErrorCases) {
  test(`${expectedName} extends ThrottleError and mentions the key`, (t) => {
    const error = new ErrorClass('order:42');

    t.true(error instanceof ErrorClass);
    t.true(error instanceof ThrottleError);
    t.true(error instanceof Error);
    t.is(error.name, expectedName);
    t.is(error.key, 'order:42');
    t.regex(error.message, /order:42/);
  });
}
