import {
  setImmediate as nextTurn,
  setTimeout as delay,
} from 'node:timers/promises';

const pollUntil = async (
  condition: () => boolean,
  timeoutMs: number,
  pause: () => Promise<unknown>,
): Promise<void> => {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(`condition was not met within ${timeoutMs}ms`);
    }
    await pause();
  }
};

export function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
  pollIntervalMs = 5,
): Promise<void> {
  return pollUntil(condition, timeoutMs, () => delay(pollIntervalMs));
}

export function waitForEachTurn(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  return pollUntil(condition, timeoutMs, () => nextTurn());
}
