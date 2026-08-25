import { afterEach, describe, expect, it } from 'vitest';
import { decodeSubscriptionMutationIntent } from '../src/domain/internal/subscription-mutation-intent';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { addSubscriptionMutationRecovery } from '../src/infrastructure/storage/knex/migrations/subscription-mutation-recovery';
import { KnexSubscriptionMutationClaimRepository } from '../src/infrastructure/storage/knex/repositories/knex-subscription-mutation-claim.repository';
import { createTestDb } from './support/knex';
import {
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

const databases: ReturnType<typeof createTestDb>[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

describe('subscription mutation recovery forward migration', () => {
  it('upgrades and replays a pre-recovery step-021 schema', async () => {
    const database = createTestDb();
    databases.push(database);
    await createPreRecoveryClaimsTable(database);
    await database.schema.createTable('payable_subscription_price_migrations', (table) => {
      table.string('id').primary();
    });

    const rawProjection = JSON.stringify({
      itemId: 'item-legacy',
      source: { priceId: 'price-old', quantity: 1 },
      target: { priceId: 'price-old', quantity: 2 },
      projectItem: true,
      projectSubscriptionPrice: false,
      projectSubscriptionQuantity: true,
    });
    await database('payable_subscription_mutation_claims').insert({
      claim_reference: 'claim-legacy',
      tenant_key: 'tenant-legacy',
      subscription_id: 'subscription-legacy',
      active_subscription_id: 'subscription-legacy',
      owner_token: 'owner-legacy',
      operation: 'subscription_quantity_update',
      correlation_id: 'correlation-legacy',
      projection: rawProjection,
      status: 'active',
      claimed_at: '2026-08-25T10:00:00.000Z',
    });

    await addSubscriptionMutationRecovery(database);
    await addSubscriptionMutationRecovery(database);

    await expect(columnNames(database, 'payable_subscription_mutation_claims')).resolves.toEqual(
      expect.arrayContaining([
        'intent',
        'observation_outcome',
        'observation_evidence_reference',
        'observed_at',
      ]),
    );
    expect(
      await database.schema.hasColumn('payable_subscription_mutation_claims', 'projection'),
    ).toBe(false);
    await expect(columnNames(database, 'payable_subscription_price_migrations')).resolves.toEqual(
      expect.arrayContaining([
        'reconciliation_observation_evidence_reference',
        'reconciliation_observed_at',
      ]),
    );
    const repository = new KnexSubscriptionMutationClaimRepository(database);
    const recovered = await repository.findByReference('claim-legacy', 'tenant-legacy');
    expect(recovered?.intent).toMatch(/^payable:subscription-mutation-intent:v1:/u);
    if (!recovered?.intent) throw new Error('Expected transformed legacy intent');
    expect(decodeSubscriptionMutationIntent(recovered.intent)).toMatchObject({
      itemId: 'item-legacy',
      target: { quantity: 2 },
    });
    await expect(
      repository.resolve({
        claimReference: recovered.claimReference,
        tenantId: recovered.tenantId,
        expectedOwnerToken: recovered.ownerToken,
        outcome: 'applied',
        evidenceReference: 'operator-legacy-resolution',
        resolvedAt: new Date('2026-08-25T11:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'applied' });
  });

  it('converges fresh and upgraded observation constraints', async () => {
    const fresh = createTestDb();
    const upgraded = createTestDb();
    databases.push(fresh, upgraded);
    await migrate(fresh);
    await upgraded.schema.createTable('payable_subscription_mutation_claims', (table) => {
      table.string('claim_reference').primary();
      table.text('projection').nullable();
    });
    await upgraded.schema.createTable('payable_subscription_price_migrations', (table) => {
      table.string('id').primary();
    });
    await addSubscriptionMutationRecovery(upgraded);

    for (const [table, constraint] of [
      [
        'payable_subscription_mutation_claims',
        'payable_subscription_mutation_claims_observation_check',
      ],
      [
        'payable_subscription_price_migrations',
        'payable_subscription_price_migrations_observation_check',
      ],
    ] as const) {
      const freshConstraint = namedConstraintSql(await tableSql(fresh, table), constraint);
      const upgradedConstraint = namedConstraintSql(await tableSql(upgraded, table), constraint);
      expect(upgradedConstraint).toBe(freshConstraint);
      expect(freshConstraint).not.toBe('');
    }
  });

  it('projects an upgraded legacy intent through the public resolver', async () => {
    const { database, payable, storage, subscription } = await setupMigrationPreview(databases);
    await database.schema.dropTable('payable_subscription_mutation_claims');
    await createPreRecoveryClaimsTable(database);
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id, TENANT);
    if (!item) throw new Error('Expected legacy subscription item');
    await database('payable_subscription_mutation_claims').insert({
      claim_reference: 'legacy-public-resolution',
      tenant_key: TENANT,
      subscription_id: subscription.id,
      active_subscription_id: subscription.id,
      owner_token: 'legacy-public-owner',
      operation: 'subscription_quantity_update',
      correlation_id: 'legacy-public-correlation',
      projection: JSON.stringify({
        itemId: item.id,
        source: { priceId: item.priceId, quantity: 1 },
        target: { priceId: item.priceId, quantity: 4 },
        projectItem: true,
        projectSubscriptionPrice: false,
        projectSubscriptionQuantity: true,
      }),
      status: 'active',
      claimed_at: '2026-08-25T10:00:00.000Z',
    });
    await addSubscriptionMutationRecovery(database);
    await addSubscriptionMutationRecovery(database);

    await expect(
      payable.subscriptionMutationClaims(TENANT).resolve('legacy-public-resolution', {
        idempotencyKey: 'resolve-upgraded-legacy-intent',
        outcome: 'applied',
        evidenceReference: 'operator-upgraded-legacy-intent',
      }),
    ).resolves.toMatchObject({ status: 'resolved', resolutionOutcome: 'applied' });
    await expect(storage.subscriptions.findById(subscription.id, TENANT)).resolves.toMatchObject({
      quantity: 4,
      acceptedQuantity: 4,
    });
  });
});

async function columnNames(database: ReturnType<typeof createTestDb>, table: string) {
  return Object.keys(await database(table).columnInfo());
}

async function tableSql(database: ReturnType<typeof createTestDb>, table: string): Promise<string> {
  const row = await database('sqlite_master').where({ type: 'table', name: table }).first('sql');
  return String(row?.sql ?? '');
}

async function createPreRecoveryClaimsTable(
  database: ReturnType<typeof createTestDb>,
): Promise<void> {
  await database.schema.createTable('payable_subscription_mutation_claims', (table) => {
    table.string('claim_reference').primary();
    table.string('tenant_key').notNullable();
    table.string('subscription_id').notNullable();
    table.string('active_subscription_id').nullable();
    table.string('owner_token').notNullable();
    table.string('operation').notNullable();
    table.string('correlation_id').notNullable();
    table.text('projection').nullable();
    table.string('status').notNullable();
    table.string('resolution_outcome').nullable();
    table.text('resolution_evidence_reference').nullable();
    table.timestamp('resolved_at').nullable();
    table.timestamp('claimed_at').notNullable();
  });
}

function namedConstraintSql(schema: string, constraint: string): string {
  const normalized = schema
    .replaceAll('`', '')
    .replaceAll('"', '')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  const prefix = `constraint ${constraint.toLowerCase()} check`;
  const start = normalized.indexOf(prefix);
  if (start < 0) return '';
  const expressionStart = normalized.indexOf('(', start + prefix.length);
  if (expressionStart < 0) return '';
  let depth = 0;
  for (let index = expressionStart; index < normalized.length; index += 1) {
    if (normalized[index] === '(') depth += 1;
    if (normalized[index] === ')') depth -= 1;
    if (depth === 0) return normalized.slice(expressionStart, index + 1);
  }
  return '';
}
