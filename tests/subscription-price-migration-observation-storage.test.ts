import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StorageDriver } from '../src/domain/contracts';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma/prisma-storage.driver';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import {
  migrationCasLifecycle,
  migrationInput,
  STORAGE_TIME,
  seedMigrationDependencies,
} from './support/subscription-price-migration-storage-contract';

describe('Knex migration observation ownership', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('CASes the first observation and never overwrites its evidence', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    await assertObservationCas(
      new KnexStorageDriver(database, new FakeClock(STORAGE_TIME)),
      'knex',
    );
  });
});

describe('Prisma migration observation ownership', () => {
  let client: PrismaClientLike;
  beforeAll(async () => {
    client = await createPrismaTestClient();
  });
  afterAll(async () => disconnectPrisma(client));

  it('CASes the first observation and never overwrites its evidence', async () => {
    await assertObservationCas(
      new PrismaStorageDriver(client, new FakeClock(STORAGE_TIME)),
      'prisma',
    );
  });
});

async function assertObservationCas(storage: StorageDriver, suffix: string): Promise<void> {
  const tenantId = `observation-${suffix}`;
  const dependencies = await seedMigrationDependencies(storage, tenantId, suffix);
  const repository = storage.subscriptionPriceMigrations;
  const preview = await repository.create(migrationInput(dependencies, { tenantId }));
  const token = `observation-owner-${suffix}`;
  await repository.compareAndSwapState({
    id: preview.id,
    tenantId,
    expectedStatus: 'previewed',
    expectedExecutionToken: null,
    nextStatus: 'executing',
    executionToken: token,
    ...migrationCasLifecycle({ attemptCount: 1, executionStartedAt: STORAGE_TIME }),
  });
  await repository.compareAndSwapState({
    id: preview.id,
    tenantId,
    expectedStatus: 'executing',
    expectedExecutionToken: token,
    nextStatus: 'reconciliation_required',
    executionToken: token,
    ...migrationCasLifecycle({
      attemptCount: 1,
      executionStartedAt: STORAGE_TIME,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
      failureMessage: 'Provider outcome is unknown and requires reconciliation',
      reconciliationRequiredAt: STORAGE_TIME,
    }),
  });
  const observation = (
    evidenceReference: string,
    expectedExecutionToken = token,
    executionToken = token,
  ) => ({
    id: preview.id,
    tenantId,
    expectedStatus: 'reconciliation_required' as const,
    expectedExecutionToken,
    outcome: 'unknown' as const,
    nextStatus: 'reconciliation_required' as const,
    executionToken,
    evidenceReference,
    reconciliationObservedAt: STORAGE_TIME,
    updatedAt: STORAGE_TIME,
  });
  await expect(
    repository.resolveReconciliation(
      observation('storage-observation-token-rotation', token, 'rotated-owner'),
    ),
  ).resolves.toBeNull();
  const competing = await Promise.all([
    repository.resolveReconciliation(observation('storage-observation-a')),
    repository.resolveReconciliation(observation('storage-observation-b')),
  ]);
  expect(competing.filter(Boolean)).toHaveLength(1);
  expect(competing.find(Boolean)).toMatchObject({ transitionApplied: true });
  const persisted = await repository.findById(preview.id, tenantId);
  const evidence = persisted?.reconciliationObservationEvidenceReference;
  if (!evidence) throw new Error('Expected one persisted observation');
  await expect(
    repository.resolveReconciliation(
      observation(evidence, token, 'rotated-owner-after-observation'),
    ),
  ).resolves.toBeNull();
  await expect(repository.resolveReconciliation(observation(evidence))).resolves.toMatchObject({
    migration: { reconciliationObservationEvidenceReference: evidence },
    transitionApplied: false,
  });
  await expect(
    repository.resolveReconciliation(observation('storage-observation-conflict')),
  ).resolves.toBeNull();
  await expect(
    repository.resolveReconciliation(observation(evidence, 'not-the-owner')),
  ).resolves.toBeNull();
}
