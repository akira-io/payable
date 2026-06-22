import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../../../domain/contracts/idempotency-store.contract';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 2
export class KnexIdempotencyRepository implements IdempotencyStore {
  constructor(protected readonly connection: unknown) {}

  find(): Promise<IdempotencyRecord | null> {
    return this.unsupported('find');
  }

  put(): Promise<void> {
    return this.unsupported('put');
  }

  markCompleted(): Promise<void> {
    return this.unsupported('markCompleted');
  }

  markFailed(): Promise<void> {
    return this.unsupported('markFailed');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexIdempotencyRepository.${op} (Phase 2)`);
  }
}
