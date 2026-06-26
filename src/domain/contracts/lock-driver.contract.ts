export interface Lock {
  release(): Promise<void>;
}

export interface LockDriver {
  readonly distributed?: boolean;
  acquire(key: string, ttlMs: number): Promise<Lock | null>;
  withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T>;
}
