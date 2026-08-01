import type { ProductRepository } from '../../src/domain/contracts/product-repository.contract';
import type {
  Repositories,
  StorageDriver,
} from '../../src/domain/contracts/storage-driver.contract';

export function coordinateNextProductReads(storage: StorageDriver): StorageDriver {
  let readCount = 0;
  let releaseReads: () => void = () => undefined;
  const readsReady = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const products = Object.create(storage.products) as ProductRepository;
  products.findByProviderId = async (...arguments_) => {
    const product = await storage.products.findByProviderId(...arguments_);
    readCount += 1;
    if (readCount === 2) {
      releaseReads();
    }
    await readsReady;
    return product;
  };
  const coordinated = Object.create(storage) as StorageDriver;
  coordinated.transaction = async (work) => {
    const repositories = Object.create(storage) as Repositories;
    Object.defineProperty(repositories, 'products', { value: products });
    return work(repositories);
  };
  return coordinated;
}
