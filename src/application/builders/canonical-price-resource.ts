import type { CatalogPage } from '../../domain/dtos/catalog.dto';
import type {
  CanonicalPrice,
  CanonicalPriceType,
} from '../../domain/entities/canonical-price.entity';
import type { RecurringInterval } from '../../domain/entities/common';
import { PayableError } from '../../domain/errors/payable-error';
import { validateLookupKey, validateLookupKeys } from '../../domain/validation/price-lookup-key';
import type { Money } from '../../domain/value-objects/money';
import {
  decodeCanonicalCatalogCursor,
  encodeCanonicalCatalogCursor,
} from './canonical-catalog-page-cursor';
import type { LocalDependencies } from './local-dependencies';

const DEFAULT_CATALOG_LIMIT = 25;
const MAX_CATALOG_LIMIT = 100;

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
  active?: boolean;
  productId?: string;
  type?: CanonicalPriceType;
  lookupKeys?: string[];
}

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

  async list(input: ListCanonicalPricesInput = {}): Promise<CatalogPage<CanonicalPrice>> {
    const limit = normalizeLimit(input.limit);
    const lookupKeys =
      input.lookupKeys === undefined ? undefined : validateLookupKeys(input.lookupKeys);
    const page = await this.repository().list(
      {
        limit,
        before: input.cursor ? decodeCanonicalCatalogCursor(input.cursor) : undefined,
        active: input.active,
        productId: input.productId,
        type: input.type,
        lookupKeys,
      },
      this.dependencies.tenantId ?? null,
    );
    const last = page.items.at(-1);
    return {
      data: page.items,
      nextCursor:
        page.hasMore && last
          ? encodeCanonicalCatalogCursor({ createdAt: last.createdAt, id: last.id })
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
    const repository = this.dependencies.storage?.canonicalPrices;
    if (!repository) {
      throw new PayableError('Canonical price management requires a storage driver', {
        code: 'PRICE_STORAGE_REQUIRED',
      });
    }
    return repository;
  }
}

function normalizeLimit(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_CATALOG_LIMIT;
  }
  return Math.min(Math.floor(requested), MAX_CATALOG_LIMIT);
}
