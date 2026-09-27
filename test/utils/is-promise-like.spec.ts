import test from 'ava';
import { isPromiseLike } from '../../src/utils/is-promise-like';

test('recognises native promises', (t) => {
  t.true(isPromiseLike(Promise.resolve('value')));
});

test('recognises objects and functions that inherit a callable then', (t) => {
  const promiseShapedObject: unknown = Object.create(Promise.prototype);
  const promiseShapedFunction: unknown = Object.setPrototypeOf(
    () => undefined,
    Promise.prototype,
  );

  t.true(isPromiseLike(promiseShapedObject));
  t.true(isPromiseLike(promiseShapedFunction));
});

test('rejects values without a callable then', (t) => {
  const recordWithThenField: unknown = JSON.parse('{"then":"not callable"}');
  const nonThenables: unknown[] = [
    undefined,
    null,
    0,
    'then',
    {},
    recordWithThenField,
    () => undefined,
  ];

  for (const value of nonThenables) {
    t.false(isPromiseLike(value));
  }
});
