import type { NewPrice } from '../../../domain/contracts/price-repository.contract';
import type { NewProduct } from '../../../domain/contracts/product-repository.contract';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { Metadata } from '../../../domain/entities/common';
import type { Price } from '../../../domain/entities/price.entity';
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

export function newPriceFromDto(
  price: PriceDTO,
  productId: string,
  provider: string,
  tenantId: string | null,
): NewPrice {
  return {
    tenantId,
    provider,
    providerPriceId: price.providerPriceId,
    productId,
    currency: price.unitAmount.currency(),
    unitAmount: price.unitAmount.amount(),
    interval: price.interval,
    intervalCount: price.intervalCount,
    active: price.active,
  };
}

export function priceSnapshot(price: Price): Record<string, unknown> {
  return {
    id: price.id,
    tenantId: price.tenantId,
    provider: price.provider,
    providerPriceId: price.providerPriceId,
    productId: price.productId,
    currency: price.currency,
    unitAmount: price.unitAmount,
    interval: price.interval,
    intervalCount: price.intervalCount,
    active: price.active,
  };
}

export function priceMatches(price: Price, target: NewPrice): boolean {
  return (
    price.tenantId === target.tenantId &&
    price.provider === target.provider &&
    price.providerPriceId === target.providerPriceId &&
    price.productId === target.productId &&
    price.currency === target.currency &&
    price.unitAmount === target.unitAmount &&
    price.interval === target.interval &&
    price.intervalCount === target.intervalCount &&
    price.active === target.active
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
