import type { NewRefund } from '../../../../domain/contracts/refund-repository.contract';
import type { CollectionMethod } from '../../../../domain/entities/payment.entity';
import type { Refund } from '../../../../domain/entities/refund.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { RefundStatus } from '../../../../domain/value-objects/refund-status';
import type { PrismaRefundRow } from '../prisma-client.types';
import { fromMinor, toMinor } from './shared';

export function refundToEntity(row: PrismaRefundRow): Refund {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    paymentId: row.paymentId,
    provider: row.provider ?? null,
    providerRefundId: row.providerRefundId ?? null,
    status: row.status as RefundStatus,
    currency: CurrencyManager.normalize(row.currency),
    amount: toMinor(row.amount, 'amount'),
    reason: row.reason ?? null,
    collectionMethod: (row.collectionMethod as CollectionMethod | null) ?? null,
    occurredAt: row.occurredAt ?? null,
    externalReference: row.externalReference ?? null,
    recordedBy: row.recordedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function refundToRow(data: Partial<NewRefund>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    paymentId: data.paymentId,
    provider: data.provider,
    providerRefundId: data.providerRefundId,
    status: data.status,
    currency: data.currency,
    amount: fromMinor(data.amount),
    reason: data.reason,
    collectionMethod: data.collectionMethod,
    occurredAt: data.occurredAt,
    externalReference: data.externalReference,
    recordedBy: data.recordedBy,
  };
}
