import test from 'ava';
import { MemoryEngine } from '../../../src/engines/memory-engine';
import { ThrottleDestroyedError } from '../../../src/throttle-errors';
import { ThrottleWindow } from '../../../src/window/throttle-window';

test('exec after destroy rejects with ThrottleDestroyedError', async (t) => {
  const window = new ThrottleWindow('destroy:');
  window.destroy();
  const job = window.job('k', () => 'never');

  await t.throwsAsync(job.exec(), { instanceOf: ThrottleDestroyedError });
  await t.throwsAsync(job.waitFinish().exec(), {
    instanceOf: ThrottleDestroyedError,
  });
  t.is(window.keyCount, 0);
});

test('destroy twice is safe', (t) => {
  const window = new ThrottleWindow('destroy:');
  window.destroy();

  t.notThrows(() => window.destroy());
});

test.serial('destroy also clears the default MemoryEngine it owns', (t) => {
  const clearedEngines: MemoryEngine[] = [];
  const originalClear = MemoryEngine.prototype.clear;
  MemoryEngine.prototype.clear = function (this: MemoryEngine): Promise<void> {
    clearedEngines.push(this);
    return originalClear.call(this);
  };
  t.teardown(() => {
    MemoryEngine.prototype.clear = originalClear;
  });
  const window = new ThrottleWindow('destroy:');

  window.destroy();
  window.destroy();

  t.is(clearedEngines.length, 1);
});

test('destroy leaves an engine it does not own intact', async (t) => {
  const engine = new MemoryEngine();
  t.teardown(() => engine.clear());
  const window = new ThrottleWindow('destroy:', { engine });
  await window.job('k', () => undefined).exec();

  window.destroy();

  t.is(engine.size, 1);
});
