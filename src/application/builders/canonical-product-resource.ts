import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { CanonicalProduct } from '../../domain/entities/canonical-product.entity';
import type { Metadata } from '../../domain/entities/common';
import { PayableError } from '../../domain/errors/payable-error';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import type { LocalDependencies } from './local-dependencies';

export interface CreateCanonicalProductInput {
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Metadata;
}

export interface ListCanonicalProductsInput {
  limit?: number;
  cursor?: string;
  id?: string;
  active?: boolean;
  name?: string;
  description?: string;
  includeBindings?: boolean;
}

export interface ProductBindingMetadata {
  id: string;
  provider: string;
  providerProductId: string;
}

export type CanonicalProductPageItem = CanonicalProduct & {
  bindings?: ProductBindingMetadata[];
};

export interface UpdateCanonicalProductInput {
  name?: string;
  description?: string | null;
  metadata?: Metadata | null;
}

export class CanonicalProductResource {
  constructor(private readonly dependencies: LocalDependencies) {}

  create(input: CreateCanonicalProductInput): Promise<CanonicalProduct> {
    return this.repository().create({
      tenantId: this.dependencies.tenantId ?? null,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    });
  }

  async retrieve(id: string): Promise<CanonicalProduct> {
    const product = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!product) {
      throw new PayableError(`Product not found: ${id}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId: id },
      });
    }
    return product;
  }

  update(id: string, input: UpdateCanonicalProductInput): Promise<CanonicalProduct> {
    return this.repository().update(id, input, this.dependencies.tenantId ?? null);
  }

  archive(id: string): Promise<CanonicalProduct> {
    return this.repository().update(id, { active: false }, this.dependencies.tenantId ?? null);
  }

  activate(id: string): Promise<CanonicalProduct> {
    return this.repository().update(id, { active: true }, this.dependencies.tenantId ?? null);
  }

  reactivate(id: string): Promise<CanonicalProduct> {
    return this.repository().update(id, { active: true }, this.dependencies.tenantId ?? null);
  }

  async list(
    input: ListCanonicalProductsInput = {},
  ): Promise<CollectionPage<CanonicalProductPageItem>> {
    const limit = normalizeCollectionLimit(input.limit);
    const filters = {
      id: input.id,
      active: input.active,
      name: normalizeSearch(input.name),
      description: normalizeSearch(input.description),
      includeBindings: input.includeBindings ?? false,
    };
    const context = {
      resource: 'products',
      tenantId: this.dependencies.tenantId ?? null,
      filters,
    };
    const page = await this.repository().list(
      {
        limit,
        before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
        id: filters.id,
        active: filters.active,
        name: filters.name,
        description: filters.description,
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

  private repository() {
    const repository = this.requireStorage().canonicalProducts;
    if (!repository) {
      throw new PayableError('Canonical product management requires a storage driver', {
        code: 'PRODUCT_STORAGE_REQUIRED',
      });
    }
    return repository;
  }

  private requireStorage() {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Canonical product management requires a storage driver', {
        code: 'PRODUCT_STORAGE_REQUIRED',
      });
    }
    return storage;
  }

  private async includeBindingMetadata(
    products: CanonicalProduct[],
  ): Promise<CanonicalProductPageItem[]> {
    const repository = this.requireStorage().productProviderBindings;
    if (!repository) {
      throw new PayableError('Product binding metadata requires a storage driver', {
        code: 'PRODUCT_BINDING_STORAGE_REQUIRED',
      });
    }
    const productIds = products.map(({ id }) => id);
    const bindings = repository.listByProductIds
      ? await repository.listByProductIds(productIds, this.dependencies.tenantId ?? null)
      : (
          await Promise.all(
            productIds.map((id) =>
              repository.listByProductId(id, this.dependencies.tenantId ?? null),
            ),
          )
        ).flat();
    const byProduct = new Map<string, ProductBindingMetadata[]>();
    for (const { id, productId, provider, providerProductId } of bindings) {
      const productBindings = byProduct.get(productId) ?? [];
      productBindings.push({ id, provider, providerProductId });
      byProduct.set(productId, productBindings);
    }
    return products.map((product) => ({
      ...product,
      bindings: byProduct.get(product.id) ?? [],
    }));
  }
}

function normalizeSearch(value?: string): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase('en-US');
  return normalized ? normalized : undefined;
}
