import { isPromiseLike } from './is-promise-like';

const ignoreRejection = (): undefined => undefined;

export function invokeSafely(callback: () => unknown): void {
  try {
    const result = callback();
    if (isPromiseLike(result)) {
      result.then(undefined, ignoreRejection);
    }
  } catch {
    return;
  }
}
