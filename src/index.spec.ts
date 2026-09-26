import test from 'ava';
import { starter } from 'src';

test(`default test`, (t) => {
  t.is(starter, true);
});
