import type { InvoicePaymentRepository } from '../../../../domain/contracts/invoice-payment-repository.contract';
import type { InvoicePayment } from '../../../../domain/entities/invoice-payment.entity';
import type { PrismaClient } from '../prisma-client.types';
import type { PrismaInvoicePaymentRow } from '../prisma-invoice-row.types';

export class PrismaInvoicePaymentRepository implements InvoicePaymentRepository {
  constructor(private readonly client: PrismaClient) {}

  async attach(relation: InvoicePayment): Promise<InvoicePayment> {
    const payment = await this.client.payablePayment.findFirst({
      where: { id: relation.paymentId, tenantKey: relation.tenantId ?? '' },
    });
    if (!payment) throw new Error('Payment not found for invoice tenant');
    const row = await this.client.payableInvoicePayment.upsert({
      where: {
        tenantKey_invoiceId_paymentId: {
          tenantKey: relation.tenantId ?? '',
          invoiceId: relation.invoiceId,
          paymentId: relation.paymentId,
        },
      },
      create: {
        tenantId: relation.tenantId,
        tenantKey: relation.tenantId ?? '',
        invoiceId: relation.invoiceId,
        paymentId: relation.paymentId,
        createdAt: relation.createdAt,
      },
      update: {},
    });
    return this.toEntity(row);
  }

  async detach(invoiceId: string, paymentId: string, tenantId: string | null): Promise<void> {
    await this.client.payableInvoicePayment.deleteMany({
      where: { tenantKey: tenantId ?? '', invoiceId, paymentId },
    });
  }

  async listByInvoiceId(invoiceId: string, tenantId: string | null) {
    return this.listByInvoiceIds([invoiceId], tenantId);
  }

  async listByInvoiceIds(invoiceIds: string[], tenantId: string | null) {
    if (invoiceIds.length === 0) return [];
    const rows = await this.client.payableInvoicePayment.findMany({
      where: { tenantKey: tenantId ?? '', invoiceId: { in: invoiceIds } },
      orderBy: [{ createdAt: 'asc' }, { paymentId: 'asc' }],
    });
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: PrismaInvoicePaymentRow): InvoicePayment {
    return {
      tenantId: row.tenantId,
      invoiceId: row.invoiceId,
      paymentId: row.paymentId,
      createdAt: row.createdAt,
    };
  }
}
