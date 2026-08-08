import { describe, expect, it } from 'vitest';
import {
  addCanonicalLocalSubscriptions,
  dropLegacyUniqueIdentity,
} from '../src/infrastructure/storage/knex/migrations/canonical-local-subscriptions';
import { createTestDb } from './support/knex';

describe('canonical local subscriptions migration', () => {
  it('drops PostgreSQL unique constraints through the table constraint', async () => {
    const statements: Array<{ sql: string; bindings?: unknown[] }> = [];
    const knex = {
      client: { dialect: 'postgresql' },
      raw: async (sql: string, bindings?: unknown[]) => {
        statements.push({ sql, bindings });
        if (sql.includes('pg_indexes')) return { rows: [{ present: true }] };
        if (sql.includes('pg_constraint')) return { rows: [{ present: true }] };
        return { rows: [] };
      },
    };

    await dropLegacyUniqueIdentity(knex as never, 'payable_subscriptions_customer_id_name_unique');

    expect(statements.at(-1)).toEqual({
      sql: 'ALTER TABLE ?? DROP CONSTRAINT ??',
      bindings: ['payable_subscriptions', 'payable_subscriptions_customer_id_name_unique'],
    });
  });

  it('drops MySQL unique identities as indexes on the owning table', async () => {
    const statements: Array<{ sql: string; bindings?: unknown[] }> = [];
    const knex = {
      client: { dialect: 'mysql' },
      raw: async (sql: string, bindings?: unknown[]) => {
        statements.push({ sql, bindings });
        if (sql.includes('information_schema.statistics')) return [[{ count: 1 }], undefined];
        return undefined;
      },
    };

    await dropLegacyUniqueIdentity(knex as never, 'payable_subscriptions_customer_id_name_unique');

    expect(statements.at(-1)).toEqual({
      sql: 'DROP INDEX ?? ON ??',
      bindings: ['payable_subscriptions_customer_id_name_unique', 'payable_subscriptions'],
    });
  });

  it('backfills legacy provider identity and permits provider-independent rows', async () => {
    const database = createTestDb();
    await database.schema.createTable('payable_subscriptions', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').nullable();
      table.uuid('customer_id').notNullable();
      table.string('name').notNullable();
      table.string('provider').notNullable();
      table.string('provider_subscription_id').nullable();
      table.string('status').notNullable();
      table.uuid('price_id').nullable();
      table.integer('quantity').notNullable();
      table.timestamp('provider_synced_at').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.unique(['provider', 'provider_subscription_id']);
      table.unique(['customer_id', 'name']);
    });
    const timestamp = '2026-08-01T00:00:00.000Z';
    await database('payable_subscriptions').insert({
      id: 'legacy-subscription',
      tenant_id: 'tenant-a',
      customer_id: 'legacy-customer',
      name: 'default',
      provider: 'stripe',
      provider_subscription_id: 'sub_legacy',
      status: 'active',
      price_id: 'price_legacy',
      quantity: 1,
      provider_synced_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await addCanonicalLocalSubscriptions(database);
    await addCanonicalLocalSubscriptions(database);

    expect(
      await database('payable_subscription_provider_bindings').where({
        tenant_key: 'tenant-a',
        subscription_id: 'legacy-subscription',
        provider: 'stripe',
        provider_subscription_id: 'sub_legacy',
      }),
    ).toHaveLength(1);
    await expect(
      database('payable_subscriptions').insert({
        id: 'local-subscription',
        tenant_id: 'tenant-a',
        tenant_key: 'tenant-a',
        customer_id: 'local-customer',
        name: 'local',
        provider: null,
        provider_subscription_id: null,
        status: 'incomplete',
        price_id: 'canonical-price',
        quantity: 1,
        canonical_price_id: 'canonical-price',
        accepted_currency: 'EUR',
        accepted_unit_amount: 1000,
        accepted_interval: 'month',
        accepted_interval_count: 1,
        accepted_quantity: 1,
        collection_responsibility: 'merchant',
        creation_source: 'migration-test',
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).resolves.toBeDefined();
    await expect(
      database('payable_subscriptions').insert({
        id: 'tenant-b-legacy-identity',
        tenant_id: 'tenant-b',
        tenant_key: 'tenant-b',
        customer_id: 'legacy-customer',
        name: 'default',
        provider: 'stripe',
        provider_subscription_id: 'sub_legacy',
        status: 'active',
        price_id: 'price_legacy',
        quantity: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).resolves.toBeDefined();
    await expect(
      database('payable_subscriptions').insert({
        id: 'tenant-a-duplicate',
        tenant_id: 'tenant-a',
        tenant_key: 'tenant-a',
        customer_id: 'legacy-customer',
        name: 'default',
        provider: null,
        provider_subscription_id: null,
        status: 'incomplete',
        price_id: 'canonical-price',
        quantity: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).rejects.toThrow(/unique/i);
    await database.destroy();
  });

  it('repairs a partial binding table with the tenant-key consistency constraint', async () => {
    const database = createTestDb();
    await database.schema.createTable('payable_subscriptions', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').nullable();
      table.string('tenant_key').notNullable().defaultTo('');
      table.uuid('customer_id').notNullable();
      table.string('name').notNullable();
      table.string('provider').nullable();
      table.string('provider_subscription_id').nullable();
      table.string('status').notNullable();
      table.uuid('price_id').nullable();
      table.integer('quantity').notNullable();
      table.timestamp('provider_synced_at').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    await database.schema.createTable('payable_subscription_provider_bindings', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').nullable();
      table.string('tenant_key').notNullable().defaultTo('');
      table.uuid('subscription_id').notNullable();
      table.string('provider').notNullable();
      table.string('provider_subscription_id').notNullable();
      table.timestamp('provider_synced_at').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    const timestamp = '2026-08-01T00:00:00.000Z';
    await database('payable_subscriptions').insert({
      id: 'partial-subscription',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      customer_id: 'partial-customer',
      name: 'default',
      provider: 'stripe',
      provider_subscription_id: 'sub_partial',
      status: 'active',
      price_id: null,
      quantity: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await addCanonicalLocalSubscriptions(database);

    await expect(
      database('payable_subscription_provider_bindings').where({
        subscription_id: 'partial-subscription',
        provider: 'stripe',
        provider_subscription_id: 'sub_partial',
      }),
    ).resolves.toHaveLength(1);
    const binding = await database('payable_subscription_provider_bindings')
      .where({ subscription_id: 'partial-subscription' })
      .first();
    await expect(
      database('payable_subscription_provider_bindings').insert({
        id: 'duplicate-binding',
        tenant_id: 'tenant-a',
        tenant_key: 'tenant-a',
        subscription_id: 'partial-subscription',
        provider: 'stripe',
        provider_subscription_id: 'sub_duplicate',
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).rejects.toThrow(/unique/i);
    expect(binding).toBeDefined();

    await expect(
      database('payable_subscription_provider_bindings').insert({
        id: 'invalid-binding',
        tenant_id: 'tenant-a',
        tenant_key: 'tenant-b',
        subscription_id: 'partial-subscription',
        provider: 'stripe',
        provider_subscription_id: 'sub_invalid',
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).rejects.toThrow(/check constraint/i);
    await database.destroy();
  });
});
