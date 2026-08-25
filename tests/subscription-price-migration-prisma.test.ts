import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import {
  PrismaIdempotencyRepository,
  PrismaStorageDriver,
} from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import {
  MIGRATION_NOW,
  migrationPreviewInput,
  seedMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

interface RawPrismaClient extends PrismaClientLike {
  $executeRawUnsafe(query: string): Promise<number>;
}

describe('Prisma canonical subscription price migration lifecycle', () => {
  const clients: PrismaClientLike[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map(disconnectPrisma)));

  async function setup() {
    const client = await createPrismaTestClient();
    clients.push(client);
    const clock = new FakeClock(MIGRATION_NOW);
    const storage = new PrismaStorageDriver(client, clock);
    const fixture = await seedMigrationPreview(
      storage,
      new PrismaIdempotencyRepository(client, clock),
      clock,
    );
    return { client: client as RawPrismaClient, ...fixture };
  }

  it('atomically projects a successful immediate migration into Prisma items and subscription', async () => {
    const { payable, storage, subscription, target } = await setup();
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'prisma-immediate' }),
    ).resolves.toMatchObject({ status: 'applied', attemptCount: 1 });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(target.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      priceId: target.id,
      canonicalPriceId: target.id,
      acceptedUnitAmount: target.unitAmount,
    });
  });

  it('rolls back a failed Prisma projection and requires reconciliation after provider success', async () => {
    const { client, payable, provider, storage, subscription, source, target } = await setup();
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    await client.$executeRawUnsafe(`
      CREATE TRIGGER fail_subscription_migration_projection
      BEFORE UPDATE OF canonical_price_id ON payable_subscriptions
      BEGIN
        SELECT RAISE(FAIL, 'forced projection failure');
      END
    `);

    await expect(
      resource.approve(preview.id, { idempotencyKey: 'prisma-projection-failure' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    await expect(resource.retrieve(preview.id)).resolves.toMatchObject({
      status: 'reconciliation_required',
      executionToken: expect.any(String),
      failureCode: 'SUBSCRIPTION_MIGRATION_PROJECTION_FAILED',
    });
    await expect(
      client.payableSubscriptionPriceMigration.findFirst({ where: { id: preview.id } }),
    ).resolves.toMatchObject({ activeSubscriptionId: subscription.id });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    expect(item?.priceId).toBe(source.id);
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      priceId: source.id,
      canonicalPriceId: source.id,
      acceptedUnitAmount: source.unitAmount,
    });
    expect(provider.applyCalls).toBe(1);
  });

  it('resolves Prisma reconciliation without another provider call and releases the claim', async () => {
    const { client, payable, provider, subscription, target } = await setup();
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'prisma-resolution-preview',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.applyError = new Error('ambiguous Prisma provider timeout');
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'prisma-resolution-ambiguous' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });
    const calls = provider.applyCalls;
    const evidenceReference = 'p'.repeat(512);

    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'prisma-resolution-not-applied',
        outcome: 'not_applied',
        evidenceReference,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      executionToken: null,
      reconciliationOutcome: 'not_applied',
      reconciliationEvidenceReference: evidenceReference,
    });
    expect(provider.applyCalls).toBe(calls);
    await expect(
      client.payableSubscriptionMutationClaim.count({
        where: { tenantKey: TENANT, subscriptionId: subscription.id },
      }),
    ).resolves.toBe(0);
  });
});
