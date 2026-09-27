import { setTimeout as delay } from 'node:timers/promises';

export async function captureUnhandledRejections(
  action: () => unknown,
  settleMs = 30,
): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const recordReason = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', recordReason);

  try {
    await action();
    await delay(settleMs);
  } finally {
    process.off('unhandledRejection', recordReason);
  }
  return reasons;
}
