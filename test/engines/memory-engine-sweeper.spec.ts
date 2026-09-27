import test from 'ava';
import { setTimeout as delay } from 'node:timers/promises';
import {
  TimerRegistry,
  type TimerHandle,
} from '../../src/utils/timer-registry';
import { MemoryEngine } from '../../src/engines/memory-engine';

interface IntervalSpy {
  readonly active: number;
  restore(): void;
}

type IntervalArgs = Parameters<TimerRegistry['setInterval']>;

const spyOnRegistryIntervals = (): IntervalSpy => {
  const { setInterval: originalSetInterval, clear: originalClear } =
    TimerRegistry.prototype;
  const activeHandles = new Set<TimerHandle>();

  TimerRegistry.prototype.setInterval = function (
    this: TimerRegistry,
    ...args: IntervalArgs
  ): TimerHandle {
    const handle = originalSetInterval.apply(this, args);
    activeHandles.add(handle);
    return handle;
  };
  TimerRegistry.prototype.clear = function (
    this: TimerRegistry,
    handle: TimerHandle | null | undefined,
  ): void {
    if (handle) {
      activeHandles.delete(handle);
    }
    originalClear.call(this, handle);
  };

  return {
    get active() {
      return activeHandles.size;
    },
    restore() {
      TimerRegistry.prototype.setInterval = originalSetInterval;
      TimerRegistry.prototype.clear = originalClear;
    },
  };
};

const withIntervalSpy = async (
  run: (spy: IntervalSpy) => Promise<void>,
): Promise<void> => {
  const spy = spyOnRegistryIntervals();
  try {
    await run(spy);
  } finally {
    spy.restore();
  }
};

test.serial('an idle engine holds no sweeper timer', (t) =>
  withIntervalSpy(async (spy) => {
    const engine = new MemoryEngine();
    await engine.get('missing');
    t.is(spy.active, 0);

    await engine.set('a', '1', { PX: 1000, NX: true });
    await engine.set('b', '1', { PX: 1000 });

    t.is(spy.active, 1);
    await engine.clear();
  }),
);

test.serial('the sweeper stops once it has emptied the store', (t) =>
  withIntervalSpy(async (spy) => {
    const engine = new MemoryEngine({ sweepIntervalMs: 20 });
    await engine.set('a', '1', { PX: 10, NX: true });

    await delay(80);

    t.is(engine.size, 0);
    t.is(spy.active, 0);
  }),
);

test.serial('the sweeper restarts when a new key is stored', (t) =>
  withIntervalSpy(async (spy) => {
    const engine = new MemoryEngine({ sweepIntervalMs: 20 });
    await engine.set('a', '1', { PX: 10, NX: true });
    await delay(80);

    await engine.set('b', '1', { PX: 10 });
    t.is(spy.active, 1);
    await delay(80);

    t.is(engine.size, 0);
    t.is(spy.active, 0);
  }),
);

test.serial('lazily dropping the last entry stops the sweeper', (t) =>
  withIntervalSpy(async (spy) => {
    const engine = new MemoryEngine();
    await engine.set('k', '1', { PX: 10, NX: true });
    await delay(30);

    t.is(await engine.get('k'), null);
    t.is(spy.active, 0);
  }),
);

test.serial('clear stops the sweeper until a key is stored again', (t) =>
  withIntervalSpy(async (spy) => {
    const engine = new MemoryEngine({ sweepIntervalMs: 20 });
    await engine.set('a', '1', { PX: 1000, NX: true });

    await engine.clear();
    t.is(spy.active, 0);
    await engine.set('b', '1', { PX: 10, NX: true });
    t.is(spy.active, 1);
    await delay(80);

    t.is(engine.size, 0);
    t.is(spy.active, 0);
  }),
);
