import type { PriceRepository } from '../../src/domain/contracts/price-repository.contract';
import type { ProductRepository } from '../../src/domain/contracts/product-repository.contract';
import type { StorageDriver } from '../../src/domain/contracts/storage-driver.contract';
import type { Price } from '../../src/domain/entities/price.entity';
import type { Product } from '../../src/domain/entities/product.entity';

type Transaction = StorageDriver['transaction'];

export interface CatalogCasReadCounts {
  recovery: number;
  transaction: number;
}

export function withProductCasLoss(
  storage: StorageDriver,
  counts: CatalogCasReadCounts,
  transactionProduct?: Product,
): StorageDriver {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'products') {
        return countedRecoveryProductRepository(target.products, counts);
      }
      if (property === 'transaction') {
        return async (work: Parameters<Transaction>[0]) =>
          target.transaction((repositories) =>
            work({
              ...repositories,
              products: losingProductRepository(repositories.products, counts, transactionProduct),
            }),
          );
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export function withPriceCasLoss(
  storage: StorageDriver,
  counts: CatalogCasReadCounts,
  transactionPrice?: Price,
): StorageDriver {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'prices') {
        return countedRecoveryPriceRepository(target.prices, counts);
      }
      if (property === 'transaction') {
        return async (work: Parameters<Transaction>[0]) =>
          target.transaction((repositories) =>
            work({
              ...repositories,
              prices: losingPriceRepository(repositories.prices, counts, transactionPrice),
            }),
          );
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function countedRecoveryProductRepository(
  repository: ProductRepository,
  counts: CatalogCasReadCounts,
): ProductRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<ProductRepository['findByProviderId']>) => {
          counts.recovery += 1;
          return target.findByProviderId(...arguments_);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function countedRecoveryPriceRepository(
  repository: PriceRepository,
  counts: CatalogCasReadCounts,
): PriceRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<PriceRepository['findByProviderId']>) => {
          counts.recovery += 1;
          return target.findByProviderId(...arguments_);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function losingProductRepository(
  repository: ProductRepository,
  counts: CatalogCasReadCounts,
  transactionProduct?: Product,
): ProductRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<ProductRepository['findByProviderId']>) => {
          counts.transaction += 1;
          if (counts.transaction === 1 && transactionProduct) {
            return Promise.resolve(transactionProduct);
          }
          return target.findByProviderId(...arguments_);
        };
      }
      if (property === 'updateIfUnchanged') {
        return async () => null;
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function losingPriceRepository(
  repository: PriceRepository,
  counts: CatalogCasReadCounts,
  transactionPrice?: Price,
): PriceRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<PriceRepository['findByProviderId']>) => {
          counts.transaction += 1;
          if (counts.transaction === 1 && transactionPrice) {
            return Promise.resolve(transactionPrice);
          }
          return target.findByProviderId(...arguments_);
        };
      }
      if (property === 'updateIfUnchanged') {
        return async () => null;
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}
