import type { CacheDriver } from '../../../domain/contracts/cache-driver.contract';
import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 7
export class RedisCacheDriver implements CacheDriver {
  constructor(protected readonly client: unknown) {}

  get<T>(): Promise<T | null> {
    return this.unsupported('get');
  }

  set(): Promise<void> {
    return this.unsupported('set');
  }

  delete(): Promise<void> {
    return this.unsupported('delete');
  }

  has(): Promise<boolean> {
    return this.unsupported('has');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`RedisCacheDriver.${op} (Phase 7)`);
  }
}
