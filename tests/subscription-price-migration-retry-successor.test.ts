import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma/prisma-storage.driver';
import { PrismaIdempotencyRepository } from '../src/infrastructure/storage/prisma/repositories/prisma-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import {
  MIGRATION_NOW,
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  seedMigrationPreview,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('Knex migration retry with an active successor', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('returns a stable conflict instead of a unique-constraint error', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const fixture = await setupMigrationPreview(databases, 'stripe', provider);
    await assertRetryConflictsWithSuccessor(fixture, provider);
  });
});

describe('Prisma migration retry with an active successor', () => {
  let client: Awaited<ReturnType<typeof createPrismaTestClient>>;

  beforeAll(async () => {
    client = await createPrismaTestClient();
  });

  afterAll(async () => disconnectPrisma(client));

  it('returns a stable conflict instead of a unique-constraint error', async () => {
    const clock = new FakeClock(MIGRATION_NOW);
    const storage = new PrismaStorageDriver(client, clock);
    const provider = new MigrationOutcomePreviewProvider();
    const fixture = await seedMigrationPreview(
      storage,
      new PrismaIdempotencyRepository(client, clock),
      clock,
      'stripe',
      provider,
    );
    await assertRetryConflictsWithSuccessor(fixture, provider);
  });
});

async function assertRetryConflictsWithSuccessor(
  fixture: Awaited<ReturnType<typeof seedMigrationPreview>>,
  provider: MigrationOutcomePreviewProvider,
): Promise<void> {
  const { payable, subscription, target } = fixture;
  const resource = payable.subscriptionPriceMigrations(TENANT);
  const first = await resource.preview({
    ...migrationPreviewInput,
    idempotencyKey: 'retry-old-preview',
    subscriptionId: subscription.id,
    targetPriceId: target.id,
  });
  provider.outcomeError = new Error('ambiguous before successor');
  await expect(
    resource.approve(first.id, { idempotencyKey: 'retry-old-ambiguous' }),
  ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
  await resource.resolve(first.id, {
    idempotencyKey: 'retry-old-resolve',
    outcome: 'not_applied',
    evidenceReference: 'provider-dashboard-retry-old',
  });
  const successor = await resource.preview({
    ...migrationPreviewInput,
    idempotencyKey: 'retry-successor-preview',
    subscriptionId: subscription.id,
    targetPriceId: target.id,
  });
  provider.outcomeError = undefined;
  const calls = provider.outcomeCalls;

  await expect(
    resource.retry(first.id, { idempotencyKey: 'retry-old-after-successor' }),
  ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
  expect(provider.outcomeCalls).toBe(calls);
  await expect(resource.retrieve(successor.id)).resolves.toMatchObject({ status: 'previewed' });
}
