import type { CatalogPage, ListProductsInput } from '../../domain/dtos/catalog.dto';
import type { CanonicalProduct } from '../../domain/entities/canonical-product.entity';
import type { Metadata } from '../../domain/entities/common';
import { PayableError } from '../../domain/errors/payable-error';
import {
  decodeCanonicalCatalogCursor,
  encodeCanonicalCatalogCursor,
} from './canonical-catalog-page-cursor';
import type { LocalDependencies } from './local-dependencies';

const DEFAULT_CATALOG_LIMIT = 25;
const MAX_CATALOG_LIMIT = 100;

export interface CreateCanonicalProductInput {
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Metadata;
}

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

  async list(input: ListProductsInput = {}): Promise<CatalogPage<CanonicalProduct>> {
    const limit = normalizeLimit(input.limit);
    const page = await this.repository().list(
      {
        limit,
        before: input.cursor ? decodeCanonicalCatalogCursor(input.cursor) : undefined,
        active: input.active,
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

  private repository() {
    const repository = this.dependencies.storage?.canonicalProducts;
    if (!repository) {
      throw new PayableError('Canonical product management requires a storage driver', {
        code: 'PRODUCT_STORAGE_REQUIRED',
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
