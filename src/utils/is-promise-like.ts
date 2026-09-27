export const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === 'object' && value !== null) ||
    typeof value === 'function') &&
  'then' in value &&
  typeof value.then === 'function';
