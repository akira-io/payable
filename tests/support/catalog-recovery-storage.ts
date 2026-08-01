import type {
  NewProduct,
  ProductRepository,
} from '../../src/domain/contracts/product-repository.contract';
import type {
  Repositories,
  StorageDriver,
} from '../../src/domain/contracts/storage-driver.contract';

type Transaction = StorageDriver['transaction'];

export function withTransaction(storage: StorageDriver, transaction: Transaction): StorageDriver {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return transaction;
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export function withOutboxFailure(storage: StorageDriver, persistenceCause: Error): StorageDriver {
  return withTransaction(storage, async (work) =>
    storage.transaction((repositories) =>
      work({
        ...repositories,
        outboxEvents: new Proxy(repositories.outboxEvents, {
          get(target, property, receiver) {
            if (property === 'create') {
              return async () => Promise.reject(persistenceCause);
            }
            const member = Reflect.get(target, property, receiver);
            return typeof member === 'function' ? member.bind(target) : member;
          },
        }),
      }),
    ),
  );
}

export function withAuditFailure(storage: StorageDriver, persistenceCause: Error): StorageDriver {
  return replaceTransactionRepositories(storage, (repositories) => ({
    ...repositories,
    auditLogs: new Proxy(repositories.auditLogs, {
      get(target, property, receiver) {
        if (property === 'create') {
          return async () => Promise.reject(persistenceCause);
        }
        const member = Reflect.get(target, property, receiver);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }),
  }));
}

export function withProductCreateFailure(
  storage: StorageDriver,
  persistenceCause: Error,
): StorageDriver {
  return replaceTransactionRepositories(storage, (repositories) => ({
    ...repositories,
    products: new Proxy(repositories.products, {
      get(target, property, receiver) {
        if (property === 'create') {
          return async () => Promise.reject(persistenceCause);
        }
        const member = Reflect.get(target, property, receiver);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }),
  }));
}

export function withProductRecoveryReadCount(
  storage: StorageDriver,
  reads: { count: number },
): StorageDriver {
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'products') {
        return countedProductRepository(target.products, reads);
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export function withLostTransactionAcknowledgement(
  storage: StorageDriver,
  persistenceCause: Error,
): StorageDriver {
  return withTransaction(storage, async (work) => {
    await storage.transaction(work);
    throw persistenceCause;
  });
}

export function withMatchingProductCreateWinner(
  storage: StorageDriver,
  winner: NewProduct,
  recoveryReads: { count: number },
): StorageDriver {
  let winnerCreated = false;
  const concurrentStorage = withTransaction(storage, async (work) => {
    if (!winnerCreated) {
      winnerCreated = true;
      await storage.products.create(winner);
    }
    return storage.transaction((repositories) =>
      work({
        ...repositories,
        products: hideFirstProductProviderRead(repositories.products),
      }),
    );
  });
  return withProductRecoveryReadCount(concurrentStorage, recoveryReads);
}

export function replaceTransactionRepositories(
  storage: StorageDriver,
  replace: (repositories: Repositories) => Repositories,
): StorageDriver {
  return withTransaction(storage, async (work) =>
    storage.transaction((repositories) => work(replace(repositories))),
  );
}

export function hideFirstProductProviderRead(repository: ProductRepository): ProductRepository {
  let hidden = false;
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<ProductRepository['findByProviderId']>) => {
          if (!hidden) {
            hidden = true;
            return Promise.resolve(null);
          }
          return target.findByProviderId(...arguments_);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function countedProductRepository(
  repository: ProductRepository,
  reads: { count: number },
): ProductRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'findByProviderId') {
        return (...arguments_: Parameters<ProductRepository['findByProviderId']>) => {
          reads.count += 1;
          return target.findByProviderId(...arguments_);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}
