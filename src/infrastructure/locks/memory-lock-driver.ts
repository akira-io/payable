import type { Lock, LockDriver } from '../../domain/contracts/lock-driver.contract';
import { PayableError } from '../../domain/errors/payable-error';

export class MemoryLockDriver implements LockDriver {
  private readonly held = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const expiresAt = this.held.get(key);
    if (expiresAt !== undefined && expiresAt > this.now()) {
      return null;
    }
    this.held.set(key, this.now() + ttlMs);
    return {
      release: async () => {
        this.held.delete(key);
      },
    };
  }

  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) {
      throw new PayableError(`Lock unavailable: ${key}`, { code: 'LOCK_UNAVAILABLE' });
    }
    try {
      return await work();
    } finally {
      await lock.release();
    }
  }
}
