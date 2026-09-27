import test from 'ava';
import { describeError } from '../../src/utils/describe-error';

test('uses the message of an Error', (t) => {
  t.is(describeError(new TypeError('engine down')), 'engine down');
});

test('stringifies a value that is not an Error', (t) => {
  t.is(describeError('plain failure'), 'plain failure');
  t.is(describeError(42), '42');
  t.is(describeError(undefined), 'undefined');
});

test('falls back to a fixed text when the value cannot be printed', (t) => {
  t.is(describeError(Object.create(null)), 'unprintable error');
});
