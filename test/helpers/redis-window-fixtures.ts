import { RedisEngine } from '../../src/engines/redis-engine';
import type {
  ThrottlePhase,
  ThrottleWindowOptions,
} from '../../src/throttle-types';
import { ThrottleWindow } from '../../src/window/throttle-window';
import type { FakeRedisClient } from './fake-redis-client';
import { createRecordingLogger } from './recording-logger';

export type InstanceRun = [string, ThrottlePhase];

export const createRedisWindow = (
  client: FakeRedisClient,
  overrides: Partial<ThrottleWindowOptions> = {},
): ThrottleWindow =>
  new ThrottleWindow('cluster:', {
    engine: new RedisEngine({ client }),
    windowMs: 50,
    debug: createRecordingLogger().logger,
    ...overrides,
  });

export const recordInstanceRuns = () => {
  const runs: InstanceRun[] = [];
  const startedAt: number[] = [];
  const job = (instance: string) => (phase: ThrottlePhase) => {
    runs.push([instance, phase]);
    startedAt.push(performance.now());
  };
  return { job, runs, startedAt };
};
