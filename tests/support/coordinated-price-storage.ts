import type { PriceRepository } from '../../src/domain/contracts/price-repository.contract';
import type {
  Repositories,
  StorageDriver,
} from '../../src/domain/contracts/storage-driver.contract';

export function coordinateNextPriceReads(storage: StorageDriver): StorageDriver {
  let readCount = 0;
  let releaseReads: () => void = () => undefined;
  const readsReady = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const prices = Object.create(storage.prices) as PriceRepository;
  prices.findByProviderId = async (...arguments_) => {
    const price = await storage.prices.findByProviderId(...arguments_);
    readCount += 1;
    if (readCount === 2) {
      releaseReads();
    }
    await readsReady;
    return price;
  };
  const coordinated = Object.create(storage) as StorageDriver;
  coordinated.transaction = async (work) => {
    const repositories = Object.create(storage) as Repositories;
    Object.defineProperty(repositories, 'prices', { value: prices });
    return work(repositories);
  };
  return coordinated;
}
