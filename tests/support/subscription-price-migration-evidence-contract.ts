import { expect } from 'vitest';
import type {
  StorageDriver,
  SubscriptionPriceMigrationRepository,
} from '../../src/domain/contracts';
import {
  decodeSubscriptionPriceMigrationExecutionEvidence,
  encodeSubscriptionPriceMigrationExecutionEvidence,
  type SubscriptionPriceMigrationExecutionEvidence,
} from '../../src/domain/internal/subscription-price-migration-execution-evidence';
import {
  type MigrationDependencies,
  migrationInput,
  seedMigrationDependencies,
} from './subscription-price-migration-storage-contract';

export async function assertInternalEvidenceForStorage(
  storage: StorageDriver,
  tenantId: string,
  suffix: string,
): Promise<void> {
  const dependencies = await seedMigrationDependencies(storage, tenantId, suffix);
  await assertInternalEvidenceStorage(storage.subscriptionPriceMigrations, dependencies, tenantId);
}

export async function assertInternalEvidenceStorage(
  repository: SubscriptionPriceMigrationRepository,
  dependencies: MigrationDependencies,
  tenantId: string,
): Promise<void> {
  const input = migrationInput(dependencies, { tenantId });
  const evidence = migrationExecutionEvidence(dependencies);
  expect(() =>
    encodeSubscriptionPriceMigrationExecutionEvidence(
      {
        ...evidence,
        proposedItems: evidence.proposedItems.map((item) => ({ ...item, itemId: 'wrong-item' })),
      },
      input.currentItems,
      input.proposedItems,
    ),
  ).toThrow(/provider_evidence\.proposedItems/);

  const created = await repository.createWithExecutionEvidence(
    input,
    encodeSubscriptionPriceMigrationExecutionEvidence(
      evidence,
      input.currentItems,
      input.proposedItems,
    ),
  );
  expect(created).not.toHaveProperty('providerEvidence');
  const stored = await repository.findExecutionEvidenceById(created.id, tenantId);
  expect(
    stored &&
      decodeSubscriptionPriceMigrationExecutionEvidence(
        stored,
        input.currentItems,
        input.proposedItems,
      ),
  ).toEqual(evidence);
  await expect(
    repository.findExecutionEvidenceById(created.id, 'other-tenant'),
  ).resolves.toBeNull();
  await expect(repository.findExecutionEvidenceById(created.id, null)).resolves.toBeNull();
}

function migrationExecutionEvidence(
  dependencies: MigrationDependencies,
): SubscriptionPriceMigrationExecutionEvidence {
  return {
    provider: 'provider-neutral-test',
    providerSubscriptionId: `provider-subscription-${dependencies.subscriptionId}`,
    currentItems: [
      {
        itemId: 'item-current',
        providerItemId: 'item-provider',
        priceId: 'price-old',
        quantity: 1,
      },
    ],
    proposedItems: [
      {
        itemId: 'item-current',
        providerItemId: 'item-provider',
        priceId: 'price-new',
        quantity: 2,
      },
    ],
  };
}
