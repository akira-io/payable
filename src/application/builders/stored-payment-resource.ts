import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { Payment } from '../../domain/entities/payment.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { CurrencyCode } from '../../domain/value-objects/currency';
import { CurrencyManager } from '../../domain/value-objects/currency';
import type { PaymentStatus } from '../../domain/value-objects/payment-status';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import type { LocalDependencies } from './local-dependencies';

export interface ListStoredPaymentsInput {
  limit?: number;
  cursor?: string;
  id?: string;
  customerId?: string;
  status?: PaymentStatus;
  currency?: string;
  reference?: string;
  description?: string;
}

export class StoredPaymentResource {
  constructor(private readonly dependencies: LocalDependencies) {}

  async retrieve(id: string): Promise<Payment> {
    const payment = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!payment) {
      throw new PayableError(`Payment not found: ${id}`, {
        code: 'PAYMENT_NOT_FOUND',
        context: { paymentId: id },
      });
    }
    return payment;
  }

  async list(input: ListStoredPaymentsInput = {}): Promise<CollectionPage<Payment>> {
    const tenantId = this.dependencies.tenantId ?? null;
    const filters = {
      id: input.id,
      customerId: input.customerId,
      status: input.status,
      currency: normalizeCurrency(input.currency),
      reference: normalizeSearch(input.reference),
      description: normalizeSearch(input.description),
    };
    const context = { resource: 'payments', tenantId, filters };
    const repository = this.repository();
    const pagePayments = repository.page;
    if (!pagePayments) {
      throw new PayableError('The payment repository does not support collection queries', {
        code: 'PAYMENT_PAGE_UNSUPPORTED',
      });
    }
    const page = await pagePayments.call(
      repository,
      {
        limit: normalizeCollectionLimit(input.limit),
        before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
        ...filters,
      },
      tenantId,
    );
    const last = page.items.at(-1);
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && last
          ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id }, context)
          : null,
    };
  }

  private repository() {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Stored payment reads require a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    return storage.payments;
  }
}

function normalizeCurrency(currency?: string): CurrencyCode | undefined {
  return currency === undefined ? undefined : CurrencyManager.normalize(currency);
}

function normalizeSearch(value?: string): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase('en-US');
  return normalized ? normalized : undefined;
}
