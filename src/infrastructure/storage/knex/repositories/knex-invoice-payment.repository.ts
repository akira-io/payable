import type { Knex } from 'knex';
import type { InvoicePaymentRepository } from '../../../../domain/contracts/invoice-payment-repository.contract';
import type { InvoicePayment } from '../../../../domain/entities/invoice-payment.entity';

const TABLE = 'payable_invoice_payments';

export class KnexInvoicePaymentRepository implements InvoicePaymentRepository {
  constructor(private readonly knex: Knex) {}

  async attach(relation: InvoicePayment): Promise<InvoicePayment> {
    const payment = await this.knex('payable_payments')
      .where({ id: relation.paymentId, tenant_key: relation.tenantId ?? '' })
      .first();
    if (!payment) throw new Error('Payment not found for invoice tenant');
    await this.knex(TABLE)
      .insert({
        tenant_id: relation.tenantId,
        tenant_key: relation.tenantId ?? '',
        invoice_id: relation.invoiceId,
        payment_id: relation.paymentId,
        created_at: relation.createdAt.toISOString(),
      })
      .onConflict(['tenant_key', 'invoice_id', 'payment_id'])
      .ignore();
    const row = await this.knex(TABLE)
      .where({
        tenant_key: relation.tenantId ?? '',
        invoice_id: relation.invoiceId,
        payment_id: relation.paymentId,
      })
      .first();
    return this.toEntity(row as Record<string, unknown>);
  }

  async detach(invoiceId: string, paymentId: string, tenantId: string | null): Promise<void> {
    await this.knex(TABLE)
      .where({ tenant_key: tenantId ?? '', invoice_id: invoiceId, payment_id: paymentId })
      .delete();
  }

  async listByInvoiceId(invoiceId: string, tenantId: string | null) {
    return this.listByInvoiceIds([invoiceId], tenantId);
  }

  async listByInvoiceIds(invoiceIds: string[], tenantId: string | null) {
    if (invoiceIds.length === 0) return [];
    const rows = (await this.knex(TABLE)
      .where({ tenant_key: tenantId ?? '' })
      .whereIn('invoice_id', invoiceIds)
      .orderBy('created_at', 'asc')
      .orderBy('payment_id', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: Record<string, unknown>): InvoicePayment {
    return {
      tenantId: (row.tenant_id as string | null) ?? null,
      invoiceId: row.invoice_id as string,
      paymentId: row.payment_id as string,
      createdAt: new Date(row.created_at as string | Date),
    };
  }
}
