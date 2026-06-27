import type { NewPayment } from '../../../../domain/contracts/payment-repository.contract';
import type { Payment } from '../../../../domain/entities/payment.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { PaymentStatus } from '../../../../domain/value-objects/payment-status';
import type { PrismaPaymentRow } from '../prisma-client.types';
import { fromMinor, toMinor } from './shared';

export function paymentToEntity(row: PrismaPaymentRow): Payment {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    customerId: row.customerId ?? null,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId ?? null,
    status: row.status as PaymentStatus,
    currency: CurrencyManager.normalize(row.currency),
    amount: toMinor(row.amount, 'amount'),
    refundedAmount: toMinor(row.refundedAmount, 'refunded_amount'),
    reference: row.reference ?? null,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paymentToRow(data: Partial<NewPayment>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    customerId: data.customerId,
    provider: data.provider,
    providerPaymentId: data.providerPaymentId,
    status: data.status,
    currency: data.currency,
    amount: fromMinor(data.amount),
    refundedAmount: fromMinor(data.refundedAmount),
    reference: data.reference,
    description: data.description,
  };
}
