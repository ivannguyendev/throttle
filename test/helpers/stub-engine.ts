import type {
  ThrottleEngine,
  ThrottleEngineSetOptions,
} from '../../src/engines/throttle-engine';

export type StubEngineOperation = 'get' | 'set' | 'del' | 'clear';

export type StubEngineIntent = 'acquire' | 'extend' | 'get' | 'del' | 'clear';

export interface StubEngineCall {
  operation: StubEngineOperation;
  intent: StubEngineIntent;
  args: readonly unknown[];
}

export type StubEngineResponder = (
  intent: StubEngineIntent,
  args: readonly unknown[],
) => unknown;

const intentOfSet = (options: ThrottleEngineSetOptions): StubEngineIntent =>
  options.NX ? 'acquire' : 'extend';

export class StubEngine implements ThrottleEngine {
  readonly calls: StubEngineCall[] = [];
  respond: StubEngineResponder;

  constructor(respond: StubEngineResponder) {
    this.respond = respond;
  }

  get(key: string): Promise<string | null> {
    return this.#invoke('get', 'get', [key]);
  }

  set(
    key: string,
    value: string,
    options: ThrottleEngineSetOptions,
  ): Promise<boolean> {
    return this.#invoke('set', intentOfSet(options), [key, value, options]);
  }

  del(key: string): Promise<void> {
    return this.#invoke('del', 'del', [key]);
  }

  clear(): Promise<void> {
    return this.#invoke('clear', 'clear', []);
  }

  #invoke<T>(
    operation: StubEngineOperation,
    intent: StubEngineIntent,
    args: readonly unknown[],
  ): Promise<T> {
    this.calls.push({ operation, intent, args });
    return this.respond(intent, args) as Promise<T>;
  }
}
