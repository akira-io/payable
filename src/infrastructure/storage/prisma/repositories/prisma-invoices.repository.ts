import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  InvoiceRepository,
  NewInvoice,
} from '../../../../domain/contracts/invoice-repository.contract';
import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type { Invoice } from '../../../../domain/entities/invoice.entity';
import { invoiceToEntity, invoiceToRow } from '../mappers/invoice.mapper';
import type { PrismaClient, PrismaInvoiceRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaInvoiceRepository
  extends PrismaRepository<Invoice, NewInvoice, PrismaInvoiceRow>
  implements InvoiceRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableInvoice, clock);
  }

  findByProviderId(
    provider: string,
    providerInvoiceId: string,
    tenantId?: string | null,
  ): Promise<Invoice | null> {
    return this.firstWhere({
      provider,
      providerInvoiceId,
      ...this.tenantClause(tenantId),
    });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Invoice[]> {
    return this.manyWhere({ customerId, ...this.tenantClause(tenantId) }, options);
  }

  protected toEntity(row: PrismaInvoiceRow): Invoice {
    return invoiceToEntity(row);
  }

  protected toRow(data: Partial<NewInvoice>): Record<string, unknown> {
    return invoiceToRow(data);
  }
}
