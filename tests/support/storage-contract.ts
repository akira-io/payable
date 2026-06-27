import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { registerBillingContract } from './contract/billing-contract';
import type { ContractContext, StorageHarness } from './contract/harness';
import { registerMoneyContract } from './contract/money-contract';
import { registerSystemContract } from './contract/system-contract';

export type { StorageHarness } from './contract/harness';
export { CONTRACT_BASE_TIME } from './contract/harness';

export function describeStorageContract(name: string, create: () => Promise<StorageHarness>): void {
  describe(`${name} storage contract`, () => {
    let current: StorageHarness;

    beforeAll(async () => {
      current = await create();
    });

    afterAll(async () => {
      await current.teardown();
    });

    beforeEach(async () => {
      await current.reset();
    });

    const ctx: ContractContext = { harness: () => current };
    registerBillingContract(ctx);
    registerMoneyContract(ctx);
    registerSystemContract(ctx);
  });
}
