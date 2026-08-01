import type { NewProduct } from '../../../domain/contracts/product-repository.contract';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { Metadata } from '../../../domain/entities/common';
import type { Product } from '../../../domain/entities/product.entity';

export function newProductFromDto(
  product: ProductDTO,
  provider: string,
  tenantId: string | null,
): NewProduct {
  return {
    tenantId,
    provider,
    providerProductId: product.providerProductId,
    name: product.name,
    description: product.description,
    active: product.active,
    metadata: product.metadata,
  };
}

export function productSnapshot(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    tenantId: product.tenantId,
    provider: product.provider,
    providerProductId: product.providerProductId,
    name: product.name,
    description: product.description,
    active: product.active,
    metadata: product.metadata,
  };
}

export function productMatches(product: Product, target: NewProduct): boolean {
  return (
    product.tenantId === target.tenantId &&
    product.provider === target.provider &&
    product.providerProductId === target.providerProductId &&
    product.name === target.name &&
    product.description === target.description &&
    product.active === target.active &&
    metadataMatches(product.metadata, target.metadata)
  );
}

function metadataMatches(current: Metadata | null, target: Metadata | null): boolean {
  if (current === target) {
    return true;
  }
  if (current === null || target === null) {
    return false;
  }
  const currentEntries = Object.entries(current).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const targetEntries = Object.entries(target).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(currentEntries) === JSON.stringify(targetEntries);
}
