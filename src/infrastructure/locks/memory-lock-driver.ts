import type { Lock, LockDriver } from '../../domain/contracts/lock-driver.contract';
import { PayableError } from '../../domain/errors/payable-error';

interface HeldLock {
  token: string;
  expiresAt: number;
}

export class MemoryLockDriver implements LockDriver {
  private readonly held = new Map<string, HeldLock>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const current = this.held.get(key);
    if (current !== undefined && current.expiresAt > this.now()) {
      return null;
    }
    const token = globalThis.crypto.randomUUID();
    this.held.set(key, { token, expiresAt: this.now() + ttlMs });
    return {
      release: async () => {
        const owned = this.held.get(key);
        if (owned?.token === token) {
          this.held.delete(key);
        }
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
