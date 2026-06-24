import type { Lock, LockDriver } from '../../domain/contracts/lock-driver.contract';
import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 7
export class RedisLockDriver implements LockDriver {
  constructor(protected readonly client: unknown) {
    throw PayableError.notImplemented('RedisLockDriver (Phase 7)');
  }

  acquire(): Promise<Lock | null> {
    return this.unsupported('acquire');
  }

  withLock<T>(): Promise<T> {
    return this.unsupported('withLock');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`RedisLockDriver.${op} (Phase 7)`);
  }
}
