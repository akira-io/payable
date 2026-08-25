import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCanonicalSubscriptionPriceMigrations } from '../src/infrastructure/storage/knex/migrations/canonical-subscription-price-migrations';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('canonical subscription price migration forward migration', () => {
  it('upgrades beta8 data idempotently with exact tenant-qualified keys and indexes', async () => {
    await createBeta8SubscriptionMigrationFixture(db);
    const subscriptionBefore = await db('payable_subscriptions').orderBy('id');
    const previewBefore = await db('payable_idempotency_keys')
      .where({ id: 'beta8-preview' })
      .first();
    expect(await db.schema.hasTable('payable_subscription_price_migrations')).toBe(false);
    expect(await indexColumns(db, 'payable_subscriptions_tenant_id_unique')).toEqual([]);
    expect(await indexColumns(db, 'payable_subscription_bindings_tenant_id_unique')).toEqual([]);

    await addCanonicalSubscriptionPriceMigrations(db);
    await expect(addCanonicalSubscriptionPriceMigrations(db)).resolves.toBeUndefined();

    expect(await db('payable_subscriptions').orderBy('id')).toEqual(subscriptionBefore);
    expect(await db('payable_idempotency_keys').where({ id: 'beta8-preview' }).first()).toEqual(
      previewBefore,
    );
    expect(await db.schema.hasColumn('payable_subscription_price_migrations', 'tenant_id')).toBe(
      false,
    );
    await expect(
      Promise.all(
        [
          'primary_item_id',
          'reconciliation_outcome',
          'reconciliation_evidence_reference',
          'reconciliation_resolved_at',
        ].map((column) => db.schema.hasColumn('payable_subscription_price_migrations', column)),
      ),
    ).resolves.toEqual([true, true, true, true]);
    const migrationColumns = await db('payable_subscription_price_migrations').columnInfo();
    expect(migrationColumns.reconciliation_evidence_reference?.type).toBe('text');
    await expect(db.schema.hasTable('payable_subscription_mutation_claims')).resolves.toBe(true);
    await expect(
      indexDefinition(
        db,
        'payable_subscription_mutation_claims',
        'payable_subscription_mutation_claims_owner_unique',
      ),
    ).resolves.toEqual({ columns: ['owner_token'], unique: true });
    const foreignKeys = (await db.raw(
      "PRAGMA foreign_key_list('payable_subscription_price_migrations')",
    )) as ForeignKeyRow[];
    expect(groupForeignKeys(foreignKeys)).toEqual([
      {
        table: 'payable_canonical_prices',
        columns: ['tenant_key:tenant_key', 'source_price_id:id'],
      },
      {
        table: 'payable_canonical_prices',
        columns: ['tenant_key:tenant_key', 'target_price_id:id'],
      },
      {
        table: 'payable_subscription_provider_bindings',
        columns: ['tenant_key:tenant_key', 'provider_binding_id:id'],
      },
      { table: 'payable_subscriptions', columns: ['tenant_key:tenant_key', 'subscription_id:id'] },
    ]);
    await expect(migrationIndexDefinitions(db)).resolves.toEqual({
      payable_subscription_price_migrations_active_unique: {
        columns: ['tenant_key', 'active_subscription_id'],
        unique: true,
      },
      payable_subscription_price_migrations_due_index: {
        columns: ['tenant_key', 'status', 'effective_at', 'id'],
        unique: false,
      },
      payable_subscription_price_migrations_subscription_page_index: {
        columns: ['tenant_key', 'subscription_id', 'created_at', 'id'],
        unique: false,
      },
      payable_subscription_price_migrations_tenant_id_unique: {
        columns: ['tenant_key', 'id'],
        unique: true,
      },
      payable_subscription_price_migrations_tenant_status_page_index: {
        columns: ['tenant_key', 'status', 'created_at', 'id'],
        unique: false,
      },
    });
    await expect(
      indexDefinition(db, 'payable_subscriptions', 'payable_subscriptions_tenant_id_unique'),
    ).resolves.toEqual({ columns: ['tenant_key', 'id'], unique: true });
    await expect(
      indexDefinition(
        db,
        'payable_subscription_provider_bindings',
        'payable_subscription_bindings_tenant_id_unique',
      ),
    ).resolves.toEqual({ columns: ['tenant_key', 'id'], unique: true });
  });
});

interface ForeignKeyRow {
  id: number;
  seq: number;
  from: string;
  table: string;
  to: string;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexDefinition {
  columns: string[];
  unique: boolean;
}

function groupForeignKeys(rows: ForeignKeyRow[]): Array<{ table: string; columns: string[] }> {
  const groups = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  return [...groups.values()]
    .map((group) => ({
      table: group[0]?.table ?? '',
      columns: group
        .sort((left, right) => left.seq - right.seq)
        .map(({ from, to }) => `${from}:${to}`),
    }))
    .sort((left, right) =>
      `${left.table}:${left.columns[1]}`.localeCompare(`${right.table}:${right.columns[1]}`),
    );
}

async function indexColumns(database: Knex, name: string): Promise<string[]> {
  const rows = (await database.raw(`PRAGMA index_info('${name}')`)) as Array<{
    seqno: number;
    name: string;
  }>;
  return rows.sort((left, right) => left.seqno - right.seqno).map(({ name: column }) => column);
}

async function indexDefinition(
  database: Knex,
  table: string,
  name: string,
): Promise<IndexDefinition | null> {
  const indexes = (await database.raw(`PRAGMA index_list('${table}')`)) as IndexListRow[];
  const index = indexes.find((candidate) => candidate.name === name);
  return index
    ? { columns: await indexColumns(database, name), unique: Boolean(index.unique) }
    : null;
}

async function migrationIndexDefinitions(database: Knex): Promise<Record<string, IndexDefinition>> {
  const indexes = (await database.raw(
    "PRAGMA index_list('payable_subscription_price_migrations')",
  )) as IndexListRow[];
  const definitions = await Promise.all(
    indexes
      .filter(({ name }) => !name.startsWith('sqlite_autoindex'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async ({ name, unique }) => [
        name,
        { columns: await indexColumns(database, name), unique: Boolean(unique) },
      ]),
  );
  return Object.fromEntries(definitions);
}

async function createBeta8SubscriptionMigrationFixture(database: Knex): Promise<void> {
  await database.schema.createTable('payable_subscriptions', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('customer_id').notNullable();
    table.string('name').notNullable();
    table.string('status').notNullable();
    table.integer('quantity').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });
  await database.schema.createTable('payable_canonical_prices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_key').notNullable().defaultTo('');
    table.unique(['tenant_key', 'id']);
  });
  await database.schema.createTable('payable_subscription_provider_bindings', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('subscription_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_subscription_id').notNullable();
  });
  await database.schema.createTable('payable_idempotency_keys', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').notNullable().defaultTo('');
    table.string('key').notNullable();
    table.text('response').nullable();
  });
  const timestamp = new Date('2026-08-01T00:00:00.000Z').toISOString();
  await database('payable_subscriptions').insert({
    id: 'beta8-subscription',
    tenant_id: 'beta8-tenant',
    tenant_key: 'beta8-tenant',
    customer_id: 'beta8-customer',
    name: 'beta8-existing',
    status: 'active',
    quantity: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  await database('payable_canonical_prices').insert([
    { id: 'beta8-source-price', tenant_key: 'beta8-tenant' },
    { id: 'beta8-target-price', tenant_key: 'beta8-tenant' },
  ]);
  await database('payable_subscription_provider_bindings').insert({
    id: 'beta8-binding',
    tenant_id: 'beta8-tenant',
    tenant_key: 'beta8-tenant',
    subscription_id: 'beta8-subscription',
    provider: 'beta8-provider',
    provider_subscription_id: 'beta8-provider-subscription',
  });
  await database('payable_idempotency_keys').insert({
    id: 'beta8-preview',
    tenant_id: 'beta8-tenant',
    key: 'subscription-change-preview:beta8',
    response: JSON.stringify({ previewToken: 'beta8' }),
  });
}
