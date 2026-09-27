import type { ThrottleEngine } from './engines/throttle-engine';

export type ThrottlePhase = 'leading' | 'trailing';

export type ThrottleJobFn<T> = (phase: ThrottlePhase) => T | Promise<T>;

export type ThrottleLogMeta = Record<string, unknown>;

export interface ThrottleLogger {
  debug(message: string, meta?: ThrottleLogMeta): void;
  info(message: string, meta?: ThrottleLogMeta): void;
  error(message: string, meta?: ThrottleLogMeta): void;
}

export interface ThrottleWindowOptions {
  engine?: ThrottleEngine;
  windowMs?: number;
  name?: string;
  debug?: boolean | ThrottleLogger;
}
