export class ThrottleError extends Error {
  readonly key: string;

  constructor(message: string, key: string) {
    super(message);
    this.name = 'ThrottleError';
    this.key = key;
  }
}

export class ThrottleTimeoutError extends ThrottleError {
  readonly timeoutMs: number;

  constructor(key: string, timeoutMs: number) {
    super(
      `Throttle job for key "${key}" did not finish within ${timeoutMs}ms`,
      key,
    );
    this.name = 'ThrottleTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ThrottleDroppedError extends ThrottleError {
  constructor(key: string) {
    super(`Throttle job for key "${key}" was dropped before it could run`, key);
    this.name = 'ThrottleDroppedError';
  }
}

export class ThrottleDestroyedError extends ThrottleError {
  constructor(key: string) {
    super(
      `Throttle window was destroyed before the job for key "${key}" could run`,
      key,
    );
    this.name = 'ThrottleDestroyedError';
  }
}
