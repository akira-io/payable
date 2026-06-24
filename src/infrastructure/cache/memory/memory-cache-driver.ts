import type { CacheDriver } from '../../../domain/contracts/cache-driver.contract';

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

export class MemoryCacheDriver implements CacheDriver {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (this.expired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : this.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    if (this.expired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  private expired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && this.now() >= entry.expiresAt;
  }
}
