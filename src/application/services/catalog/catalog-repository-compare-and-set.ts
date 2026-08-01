import type {
  NewPrice,
  PricePatch,
  PriceRepository,
} from '../../../domain/contracts/price-repository.contract';
import type {
  NewProduct,
  ProductPatch,
  ProductRepository,
} from '../../../domain/contracts/product-repository.contract';
import type { Price } from '../../../domain/entities/price.entity';
import type { Product } from '../../../domain/entities/product.entity';

interface ProductCompareAndSetRepository extends ProductRepository {
  updateIfUnchanged(
    id: string,
    expected: Product,
    patch: ProductPatch,
    tenantId: string | null,
  ): Promise<Product | null>;
}

interface PriceCompareAndSetRepository extends PriceRepository {
  updateIfUnchanged(
    id: string,
    expected: Price,
    patch: PricePatch,
    tenantId: string | null,
  ): Promise<Price | null>;
}

export async function updateCatalogProduct(
  repository: ProductRepository,
  before: Product,
  target: NewProduct,
  tenantId: string | null,
): Promise<Product | null> {
  if (supportsProductCompareAndSet(repository)) {
    return repository.updateIfUnchanged(before.id, before, target, tenantId);
  }
  return repository.update(before.id, target, tenantId);
}

export async function updateCatalogPrice(
  repository: PriceRepository,
  before: Price,
  target: NewPrice,
  tenantId: string | null,
): Promise<Price | null> {
  if (supportsPriceCompareAndSet(repository)) {
    return repository.updateIfUnchanged(before.id, before, target, tenantId);
  }
  return repository.update(before.id, target, tenantId);
}

function supportsProductCompareAndSet(
  repository: ProductRepository,
): repository is ProductCompareAndSetRepository {
  const candidate = repository as unknown as { updateIfUnchanged?: unknown };
  return typeof candidate.updateIfUnchanged === 'function';
}

function supportsPriceCompareAndSet(
  repository: PriceRepository,
): repository is PriceCompareAndSetRepository {
  const candidate = repository as unknown as { updateIfUnchanged?: unknown };
  return typeof candidate.updateIfUnchanged === 'function';
}
