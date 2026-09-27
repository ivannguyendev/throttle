import type { ThrottleLogger, ThrottleLogMeta } from '../../src/throttle-types';

export type LogLevel = keyof ThrottleLogger;
export type LogEntry = [LogLevel, string, ThrottleLogMeta | undefined];

export interface RecordingLogger {
  readonly entries: LogEntry[];
  readonly logger: ThrottleLogger;
}

export function createRecordingLogger(): RecordingLogger {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, meta?: ThrottleLogMeta): void => {
      entries.push([level, message, meta]);
    };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      error: record('error'),
    },
  };
}
