import type { NewPayment } from '../../../../domain/contracts/payment-repository.contract';
import type { CollectionMethod, Payment } from '../../../../domain/entities/payment.entity';
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
    capturedAmount: toMinor(row.capturedAmount, 'captured_amount'),
    authorizedAt: row.authorizedAt ?? null,
    authorizationExpiresAt: row.authorizationExpiresAt ?? null,
    reference: row.reference ?? null,
    description: row.description ?? null,
    collectionMethod: (row.collectionMethod as CollectionMethod | null) ?? null,
    occurredAt: row.occurredAt ?? null,
    externalReference: row.externalReference ?? null,
    recordedBy: row.recordedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paymentToRow(data: Partial<NewPayment>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    tenantKey: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
    customerId: data.customerId,
    provider: data.provider,
    providerPaymentId: data.providerPaymentId,
    status: data.status,
    currency: data.currency,
    amount: fromMinor(data.amount),
    refundedAmount: fromMinor(data.refundedAmount),
    capturedAmount: fromMinor(data.capturedAmount),
    authorizedAt: data.authorizedAt,
    authorizationExpiresAt: data.authorizationExpiresAt,
    reference: data.reference,
    description: data.description,
    collectionMethod: data.collectionMethod,
    occurredAt: data.occurredAt,
    externalReference: data.externalReference,
    recordedBy: data.recordedBy,
  };
}
