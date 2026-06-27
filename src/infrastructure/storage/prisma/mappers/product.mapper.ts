import type { NewProduct } from '../../../../domain/contracts/product-repository.contract';
import type { Metadata } from '../../../../domain/entities/common';
import type { Product } from '../../../../domain/entities/product.entity';
import type { PrismaProductRow } from '../prisma-client.types';
import { parseJson, toJsonString } from './shared';

export function productToEntity(row: PrismaProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    provider: row.provider,
    providerProductId: row.providerProductId ?? null,
    name: row.name,
    description: row.description ?? null,
    active: row.active,
    metadata: parseJson<Metadata>(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function productToRow(data: Partial<NewProduct>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    provider: data.provider,
    providerProductId: data.providerProductId,
    name: data.name,
    description: data.description,
    active: data.active,
    metadata: data.metadata === undefined ? undefined : toJsonString(data.metadata),
  };
}
