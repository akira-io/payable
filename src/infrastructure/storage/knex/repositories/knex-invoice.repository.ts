import type { InvoiceRepository } from '../../../../domain/contracts/invoice-repository.contract';
import type { Invoice } from '../../../../domain/entities/invoice.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexInvoiceRepository implements InvoiceRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Invoice> {
    return this.unsupported('create');
  }

  update(): Promise<Invoice> {
    return this.unsupported('update');
  }

  findById(): Promise<Invoice | null> {
    return this.unsupported('findById');
  }

  findByProviderId(): Promise<Invoice | null> {
    return this.unsupported('findByProviderId');
  }

  listByCustomer(): Promise<Invoice[]> {
    return this.unsupported('listByCustomer');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexInvoiceRepository.${op} (Phase 3)`);
  }
}
