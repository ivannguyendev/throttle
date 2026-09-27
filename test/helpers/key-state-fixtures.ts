import {
  KeyStateRegistry,
  type KeyStateRegistryOptions,
  type KeyWaiter,
} from '../../src/scheduler/key-state';
import { TimerRegistry } from '../../src/utils/timer-registry';
import { createRecordingLogger } from './recording-logger';

export const TEST_TAG = '[throttle:test]';

export const createTestRegistry = (
  overrides: Partial<KeyStateRegistryOptions> = {},
) => {
  const { entries, logger } = createRecordingLogger();
  const timers = new TimerRegistry();
  const registry = new KeyStateRegistry({
    timers,
    logger,
    tag: TEST_TAG,
    ...overrides,
  });
  return { entries, registry, timers };
};

export const recordingWaiter = (rejections: unknown[]): KeyWaiter => ({
  resolve: () => undefined,
  reject: (error) => {
    rejections.push(error);
  },
});

export const doneJob = (): string => 'done';
