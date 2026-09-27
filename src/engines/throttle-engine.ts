export interface ThrottleEngineSetOptions {
  PX: number;
  NX?: boolean;
}

export interface ThrottleEngine {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: ThrottleEngineSetOptions,
  ): Promise<boolean>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}
