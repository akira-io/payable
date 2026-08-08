import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type {
  CanonicalPrice,
  CanonicalPriceType,
} from '../../domain/entities/canonical-price.entity';
import type { RecurringInterval } from '../../domain/entities/common';
import { PayableError } from '../../domain/errors/payable-error';
import { validateLookupKey, validateLookupKeys } from '../../domain/validation/price-lookup-key';
import type { Money } from '../../domain/value-objects/money';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import type { LocalDependencies } from './local-dependencies';

export interface CreateCanonicalPriceInput {
  productId: string;
  unitAmount: Money;
  type: CanonicalPriceType;
  interval?: RecurringInterval;
  intervalCount?: number;
  description?: string;
  lookupKey?: string;
  active?: boolean;
}

export interface ListCanonicalPricesInput {
  limit?: number;
  cursor?: string;
  id?: string;
  active?: boolean;
  productId?: string;
  type?: CanonicalPriceType;
  lookupKey?: string;
  lookupKeys?: string[];
  includeBindings?: boolean;
}

export interface PriceBindingMetadata {
  id: string;
  provider: string;
  providerPriceId: string;
}

export type CanonicalPricePageItem = CanonicalPrice & { bindings?: PriceBindingMetadata[] };

export interface UpdateCanonicalPriceInput {
  description?: string | null;
}

export class CanonicalPriceResource {
  constructor(private readonly dependencies: LocalDependencies) {}

  async create(input: CreateCanonicalPriceInput): Promise<CanonicalPrice> {
    const tenantId = this.dependencies.tenantId ?? null;
    const product = await this.dependencies.storage?.canonicalProducts?.findById(
      input.productId,
      tenantId,
    );
    if (!product) {
      throw new PayableError(`Product not found: ${input.productId}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId: input.productId },
      });
    }
    const lookupKey = input.lookupKey === undefined ? null : validateLookupKey(input.lookupKey);
    const recurrence = this.recurrence(input);
    return this.repository().create({
      tenantId,
      productId: product.id,
      currency: input.unitAmount.currency(),
      unitAmount: input.unitAmount.amount(),
      type: input.type,
      interval: recurrence.interval,
      intervalCount: recurrence.intervalCount,
      description: input.description ?? null,
      lookupKey,
      active: input.active ?? true,
    });
  }

  async retrieve(id: string): Promise<CanonicalPrice> {
    const price = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!price) {
      throw new PayableError(`Price not found: ${id}`, {
        code: 'PRICE_NOT_FOUND',
        context: { priceId: id },
      });
    }
    return price;
  }

  update(id: string, input: UpdateCanonicalPriceInput): Promise<CanonicalPrice> {
    return this.repository().update(
      id,
      { description: input.description },
      this.dependencies.tenantId ?? null,
    );
  }

  archive(id: string): Promise<CanonicalPrice> {
    return this.repository().update(id, { active: false }, this.dependencies.tenantId ?? null);
  }

  activate(id: string): Promise<CanonicalPrice> {
    return this.repository().update(id, { active: true }, this.dependencies.tenantId ?? null);
  }

  reactivate(id: string): Promise<CanonicalPrice> {
    return this.repository().update(id, { active: true }, this.dependencies.tenantId ?? null);
  }

  async transferLookupKey(id: string, lookupKey: string): Promise<CanonicalPrice> {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Canonical price management requires a storage driver', {
        code: 'PRICE_STORAGE_REQUIRED',
      });
    }
    const tenantId = this.dependencies.tenantId ?? null;
    const validatedLookupKey = validateLookupKey(lookupKey);
    return storage.transaction(async (repositories) => {
      const prices = repositories.canonicalPrices;
      if (!prices) {
        throw new PayableError('Canonical price management requires a storage driver', {
          code: 'PRICE_STORAGE_REQUIRED',
        });
      }
      const target = await prices.findById(id, tenantId);
      if (!target) {
        throw new PayableError(`Price not found: ${id}`, {
          code: 'PRICE_NOT_FOUND',
          context: { priceId: id },
        });
      }
      const current = await prices.findByLookupKey(validatedLookupKey, tenantId);
      if (current?.id === target.id) {
        return current;
      }
      if (current) {
        await prices.update(current.id, { lookupKey: null }, tenantId);
      }
      return prices.update(target.id, { lookupKey: validatedLookupKey }, tenantId);
    });
  }

  async list(
    input: ListCanonicalPricesInput = {},
  ): Promise<CollectionPage<CanonicalPricePageItem>> {
    const limit = normalizeCollectionLimit(input.limit);
    const lookupKeys =
      input.lookupKeys === undefined
        ? undefined
        : validateLookupKeys(input.lookupKeys).toSorted((left, right) => left.localeCompare(right));
    const filters = {
      id: input.id,
      active: input.active,
      productId: input.productId,
      type: input.type,
      lookupKey: input.lookupKey === undefined ? undefined : validateLookupKey(input.lookupKey),
      lookupKeys,
      includeBindings: input.includeBindings ?? false,
    };
    const context = {
      resource: 'prices',
      tenantId: this.dependencies.tenantId ?? null,
      filters,
    };
    const page = await this.repository().list(
      {
        limit,
        before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
        id: filters.id,
        active: filters.active,
        productId: filters.productId,
        type: filters.type,
        lookupKey: filters.lookupKey,
        lookupKeys: filters.lookupKeys,
      },
      this.dependencies.tenantId ?? null,
    );
    const last = page.items.at(-1);
    const items = input.includeBindings
      ? await this.includeBindingMetadata(page.items)
      : page.items;
    return {
      items,
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && last
          ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id }, context)
          : null,
    };
  }

  private recurrence(input: CreateCanonicalPriceInput): {
    interval: RecurringInterval | null;
    intervalCount: number | null;
  } {
    if (input.type === 'recurring' && !input.interval) {
      throw new PayableError('Recurring prices require an interval', {
        code: 'PRICE_RECURRENCE_INVALID',
      });
    }
    if (
      input.type === 'recurring' &&
      input.intervalCount !== undefined &&
      (!Number.isInteger(input.intervalCount) || input.intervalCount <= 0)
    ) {
      throw new PayableError('Recurring interval count must be a positive integer', {
        code: 'PRICE_RECURRENCE_INVALID',
      });
    }
    if (
      input.type === 'one_time' &&
      (input.interval !== undefined || input.intervalCount !== undefined)
    ) {
      throw new PayableError('One-time prices cannot define a recurring interval', {
        code: 'PRICE_RECURRENCE_INVALID',
      });
    }
    return input.type === 'recurring'
      ? { interval: input.interval ?? null, intervalCount: input.intervalCount ?? 1 }
      : { interval: null, intervalCount: null };
  }

  private repository() {
    const repository = this.requireStorage().canonicalPrices;
    if (!repository) {
      throw new PayableError('Canonical price management requires a storage driver', {
        code: 'PRICE_STORAGE_REQUIRED',
      });
    }
    return repository;
  }

  private requireStorage() {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Canonical price management requires a storage driver', {
        code: 'PRICE_STORAGE_REQUIRED',
      });
    }
    return storage;
  }

  private async includeBindingMetadata(
    prices: CanonicalPrice[],
  ): Promise<CanonicalPricePageItem[]> {
    const repository = this.requireStorage().priceProviderBindings;
    if (!repository) {
      throw new PayableError('Price binding metadata requires a storage driver', {
        code: 'PRICE_BINDING_STORAGE_REQUIRED',
      });
    }
    const priceIds = prices.map(({ id }) => id);
    const bindings = repository.listByPriceIds
      ? await repository.listByPriceIds(priceIds, this.dependencies.tenantId ?? null)
      : (
          await Promise.all(
            priceIds.map((id) => repository.listByPriceId(id, this.dependencies.tenantId ?? null)),
          )
        ).flat();
    const byPrice = new Map<string, PriceBindingMetadata[]>();
    for (const { id, priceId, provider, providerPriceId } of bindings) {
      const priceBindings = byPrice.get(priceId) ?? [];
      priceBindings.push({ id, provider, providerPriceId });
      byPrice.set(priceId, priceBindings);
    }
    return prices.map((price) => ({
      ...price,
      bindings: byPrice.get(price.id) ?? [],
    }));
  }
}
