import type { RefundRepository } from '../../../../domain/contracts/refund-repository.contract';
import type { Refund } from '../../../../domain/entities/refund.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexRefundRepository implements RefundRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Refund> {
    return this.unsupported('create');
  }

  update(): Promise<Refund> {
    return this.unsupported('update');
  }

  findById(): Promise<Refund | null> {
    return this.unsupported('findById');
  }

  findByProviderId(): Promise<Refund | null> {
    return this.unsupported('findByProviderId');
  }

  listByPayment(): Promise<Refund[]> {
    return this.unsupported('listByPayment');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexRefundRepository.${op} (Phase 3)`);
  }
}
