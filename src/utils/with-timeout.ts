import type { TimerRegistry } from './timer-registry';

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
  timers: TimerRegistry,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const rejectWithTimeoutError = (): void => {
      try {
        reject(createError());
      } catch (error) {
        reject(error);
      }
    };
    const deadline = timers.setTimeout(rejectWithTimeoutError, timeoutMs, {
      kind: 'deadline',
    });
    promise.then(
      (value) => {
        timers.clear(deadline);
        resolve(value);
      },
      (error: unknown) => {
        timers.clear(deadline);
        reject(error);
      },
    );
  });
}
