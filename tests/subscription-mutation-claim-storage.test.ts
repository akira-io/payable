import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  rehydrateSubscriptionMutationIntentBlob,
  type StorageDriver,
  type SubscriptionMutationOperation,
} from '../src/domain/contracts';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma/prisma-storage.driver';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import {
  STORAGE_TIME,
  seedMigrationDependencies,
} from './support/subscription-price-migration-storage-contract';

describe('Knex subscription mutation claim storage', () => {
  let database: Knex;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    database = createTestDb();
    await migrate(database);
    storage = new KnexStorageDriver(database, new FakeClock(STORAGE_TIME));
  });

  afterEach(async () => database.destroy());

  it('enforces exact durable claim ownership', async () => {
    await assertClaimOwnership(storage, 'mutation-claim-knex', 'subscription_swap');
  });
});

describe('Prisma subscription mutation claim storage', () => {
  let client: PrismaClientLike;
  let storage: PrismaStorageDriver;

  beforeAll(async () => {
    client = await createPrismaTestClient();
    storage = new PrismaStorageDriver(client, new FakeClock(STORAGE_TIME));
  });

  afterAll(async () => disconnectPrisma(client));

  it('enforces exact durable claim ownership', async () => {
    await assertClaimOwnership(storage, 'mutation-claim-prisma', 'subscription_quantity_update');
  });
});

async function assertClaimOwnership(
  storage: StorageDriver,
  tenantId: string,
  operation: SubscriptionMutationOperation,
): Promise<void> {
  const dependencies = await seedMigrationDependencies(storage, tenantId, operation);
  const repository = storage.subscriptionMutationClaims;
  const first = {
    claimReference: `${operation}-claim-1`,
    tenantId,
    subscriptionId: dependencies.subscriptionId,
    ownerToken: `${operation}-owner-1`,
    operation,
    correlationId: `${operation}-correlation-1`,
    intent: rehydrateSubscriptionMutationIntentBlob(
      'payable:subscription-mutation-intent:v1:opaque-test-intent',
    ),
    claimedAt: STORAGE_TIME,
  };

  await expect(repository.acquire(first)).resolves.toBe(true);
  await expect(
    repository.findActiveBySubscriptionId(dependencies.subscriptionId, tenantId),
  ).resolves.toMatchObject({
    claimReference: first.claimReference,
    correlationId: first.correlationId,
    intent: first.intent,
  });
  await expect(repository.acquire({ ...first, ownerToken: `${operation}-owner-2` })).resolves.toBe(
    false,
  );
  const observation = {
    claimReference: first.claimReference,
    tenantId,
    expectedOwnerToken: first.ownerToken,
    outcome: 'unknown' as const,
    evidenceReference: 'operator-observation-512'.padEnd(512, 'x'),
    observedAt: STORAGE_TIME,
  };
  const observations = await Promise.all([
    repository.observe(observation),
    repository.observe(observation),
  ]);
  expect(observations).toEqual([
    expect.objectContaining({
      status: 'active',
      observationOutcome: 'unknown',
      observationEvidenceReference: observation.evidenceReference,
      observedAt: STORAGE_TIME,
    }),
    expect.objectContaining({
      status: 'active',
      observationOutcome: 'unknown',
      observationEvidenceReference: observation.evidenceReference,
      observedAt: STORAGE_TIME,
    }),
  ]);
  await expect(
    repository.observe({ ...observation, evidenceReference: 'conflicting-observation' }),
  ).resolves.toBeNull();
  await expect(repository.findByReference(first.claimReference, tenantId)).resolves.toMatchObject({
    status: 'active',
    observationOutcome: 'unknown',
    observationEvidenceReference: observation.evidenceReference,
    observedAt: STORAGE_TIME,
  });
  await expect(repository.release({ ...first, ownerToken: 'not-owner' })).resolves.toBe(false);
  await expect(repository.release(first)).resolves.toBe(true);
  await expect(repository.acquire({ ...first, ownerToken: `${operation}-owner-2` })).resolves.toBe(
    true,
  );
}
