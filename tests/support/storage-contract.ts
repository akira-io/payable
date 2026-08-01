import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { registerBillingContract } from './contract/billing-contract';
import { registerCatalogCasCompatibilityContract } from './contract/catalog-cas-compatibility-contract';
import { registerCatalogContract } from './contract/catalog-contract';
import { registerCatalogCreateContract } from './contract/catalog-create-contract';
import { registerCatalogMutationPersistenceContract } from './contract/catalog-mutation-persistence-contract';
import type { ContractContext, StorageHarness } from './contract/harness';
import { registerMoneyContract } from './contract/money-contract';
import { registerRepositoryCompatibilityContract } from './contract/repository-compatibility-contract';
import { registerSystemContract } from './contract/system-contract';

export type { StorageHarness } from './contract/harness';
export { CONTRACT_BASE_TIME } from './contract/harness';

export function describeStorageContract(name: string, create: () => Promise<StorageHarness>): void {
  describe(`${name} storage contract`, () => {
    let current: StorageHarness;

    beforeAll(async () => {
      current = await create();
    }, 120_000);

    afterAll(async () => {
      await current.teardown();
    });

    beforeEach(async () => {
      await current.reset();
    });

    const ctx: ContractContext = { harness: () => current };
    registerBillingContract(ctx);
    registerCatalogCreateContract(ctx);
    registerCatalogMutationPersistenceContract(ctx);
    registerCatalogContract(ctx);
    registerCatalogCasCompatibilityContract(ctx);
    registerMoneyContract(ctx);
    registerRepositoryCompatibilityContract(ctx);
    registerSystemContract(ctx);
  });
}
