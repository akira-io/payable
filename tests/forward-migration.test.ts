import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexAuditLogRepository } from '../src/infrastructure/storage/knex/repositories/knex-audit-log.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createLegacyLedgerDatabase } from './support/legacy-ledger-schema';

const auditEntry = {
  tenantId: null,
  correlationId: 'corr-new',
  actorType: null,
  actorId: null,
  action: 'payment.captured',
  resourceType: 'payment',
  resourceId: 'pay_new',
  before: null,
  after: null,
  metadata: null,
  ipAddress: null,
  userAgent: null,
};

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('forward migrations (C5)', () => {
  it('runs idempotently', async () => {
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('survives concurrent invocations', async () => {
    await Promise.all([migrate(db), migrate(db)]);
    await expect(migrate(db)).resolves.toBeUndefined();
    expect(await db.schema.hasTable('payable_outbox_events')).toBe(true);
  });

  it('aborts with an actionable error when customer billables are already duplicated', async () => {
    await db.schema.createTable('payable_customers', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').nullable();
      table.string('provider').notNullable();
      table.string('provider_customer_id').nullable();
      table.string('billable_type').notNullable();
      table.string('billable_id').notNullable();
      table.string('email').notNullable();
      table.string('name').nullable();
      table.text('metadata').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
      table.unique(['provider', 'provider_customer_id']);
    });
    const now = new Date().toISOString();
    await db('payable_customers').insert([
      {
        id: 'dup-1',
        tenant_id: null,
        provider: 'stripe',
        provider_customer_id: 'cus_a',
        billable_type: 'User',
        billable_id: '1',
        email: 'a@example.test',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'dup-2',
        tenant_id: null,
        provider: 'paddle',
        provider_customer_id: 'cus_b',
        billable_type: 'User',
        billable_id: '1',
        email: 'b@example.test',
        created_at: now,
        updated_at: now,
      },
    ]);

    await expect(migrate(db)).rejects.toThrow(/duplicate \(tenant, billable\)/);
  });

  it('round-trips a UTC instant through a timestamptz column', async () => {
    await migrate(db);
    const instant = '2026-06-22T08:30:00.000Z';
    await db('payable_customers').insert({
      id: 'cus_tz',
      provider: 'stripe',
      provider_customer_id: 'pc_tz',
      billable_type: 'User',
      billable_id: '1',
      email: 'tz@example.test',
      created_at: instant,
      updated_at: instant,
    });

    const row = await db('payable_customers').where({ id: 'cus_tz' }).first();
    expect(new Date(row.created_at).toISOString()).toBe(instant);
  });

  it('creates the composite list-access indexes', async () => {
    await migrate(db);
    const names = (await db
      .from('sqlite_master')
      .where({ type: 'index' })
      .pluck('name')) as string[];
    expect(names).toContain('payable_payments_customer_created_id_index');
    expect(names).toContain('payable_invoices_customer_created_id_index');
    expect(names).toContain('payable_subscriptions_customer_created_id_index');
    expect(names).toContain('payable_refunds_payment_created_id_index');
    expect(names).toContain('payable_outbox_events_pending_claim_index');
    expect(names).toContain('payable_outbox_events_stale_claim_index');
    expect(names).toContain('payable_webhook_events_tenant_received_id_index');
    expect(names).toContain('payable_outbox_events_tenant_dedupe_unique');
    expect(names).toContain('payable_webhook_deliveries_tenant_endpoint_event_unique');
    expect(names).toContain('payable_audit_logs_tenant_sequence_unique');
  });

  it('adds the audit chain columns and unique index to a pre-hardening table', async () => {
    await db.schema.createTable('payable_audit_logs', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').notNullable().defaultTo('');
      table.string('correlation_id').notNullable();
      table.string('actor_type').nullable();
      table.string('actor_id').nullable();
      table.string('action').notNullable();
      table.string('resource_type').notNullable();
      table.string('resource_id').notNullable();
      table.text('before').nullable();
      table.text('after').nullable();
      table.text('metadata').nullable();
      table.string('ip_address').nullable();
      table.string('user_agent').nullable();
      table.timestamp('created_at').notNullable();
    });
    await db('payable_audit_logs').insert({
      id: 'legacy-1',
      tenant_id: '',
      correlation_id: 'corr-legacy',
      action: 'legacy.event',
      resource_type: 'payment',
      resource_id: 'pay_legacy',
      created_at: new Date().toISOString(),
    });

    await migrate(db);

    expect(await db.schema.hasColumn('payable_audit_logs', 'sequence')).toBe(true);
    expect(await db.schema.hasColumn('payable_audit_logs', 'hash')).toBe(true);
    const names = (await db
      .from('sqlite_master')
      .where({ type: 'index' })
      .pluck('name')) as string[];
    expect(names).toContain('payable_audit_logs_tenant_sequence_unique');

    const repo = new KnexAuditLogRepository(db, new FakeClock(), 'audit-key');
    const created = await repo.create(auditEntry);
    expect(created.previousHash).toBeNull();
    expect(await repo.verifyChain(null)).toBe(true);
  });

  it('enforces billable uniqueness across null tenants on the default dialect', async () => {
    await migrate(db);
    const base = {
      tenant_id: null,
      billable_type: 'User',
      billable_id: '1',
      email: 'user@example.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db('payable_customers').insert({
      id: '11111111-1111-1111-1111-111111111111',
      provider: 'stripe',
      provider_customer_id: 'cus_a',
      ...base,
    });

    await expect(
      db('payable_customers').insert({
        id: '22222222-2222-2222-2222-222222222222',
        provider: 'paddle',
        provider_customer_id: 'cus_b',
        ...base,
      }),
    ).rejects.toThrow();
  });

  it('upgrades a database recorded through 003 to match a fresh installation', async () => {
    const payableTables = async (knex: Knex): Promise<string[]> =>
      (
        (await knex
          .from('sqlite_master')
          .where({ type: 'table' })
          .andWhereLike('name', 'payable_%')
          .orderBy('name')
          .pluck('name')) as string[]
      ).filter((name) => !name.includes('sqlite'));

    const legacy = createTestDb();
    await createLegacyLedgerDatabase(legacy);
    expect(await legacy.schema.hasTable('payable_webhook_endpoint_events')).toBe(false);
    expect(await legacy.schema.hasColumn('payable_outbox_events', 'dedupe_key')).toBe(false);
    expect(await legacy.schema.hasColumn('payable_webhook_events', 'claim_token')).toBe(false);
    expect(await legacy.schema.hasColumn('payable_webhook_deliveries', 'event_id')).toBe(false);

    await migrate(legacy);

    const fresh = createTestDb();
    await migrate(fresh);

    const tables = await payableTables(fresh);
    expect(await payableTables(legacy)).toEqual(tables);
    for (const table of tables) {
      const upgraded = Object.keys(await legacy(table).columnInfo()).sort();
      const pristine = Object.keys(await fresh(table).columnInfo()).sort();
      expect(upgraded, table).toEqual(pristine);
    }

    const indexes = (await legacy
      .from('sqlite_master')
      .where({ type: 'index' })
      .pluck('name')) as string[];
    expect(indexes).toContain('payable_audit_logs_tenant_sequence_unique');
    expect(indexes).toContain('payable_outbox_events_tenant_dedupe_unique');
    expect(indexes).toContain('payable_webhook_deliveries_tenant_endpoint_event_unique');
    expect(indexes).toContain('payable_outbox_events_pending_claim_index');
    expect(await legacy.schema.hasTable('payable_webhook_endpoint_events')).toBe(true);

    await legacy.destroy();
    await fresh.destroy();
  });

  it('reruns nothing for a fresh installation when the convergence step is recorded', async () => {
    await migrate(db);
    const before = await db.from('payable_migrations').orderBy('name').pluck('name');
    expect(before).toContain('007-post-ledger-schema-convergence');
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('back-fills columns added after a table was first created', async () => {
    await db.schema.createTable('payable_webhook_events', (table) => {
      table.uuid('id').primary();
      table.string('provider').notNullable();
      table.string('provider_event_id').notNullable();
      table.string('type').notNullable();
      table.text('payload').notNullable();
      table.string('status').notNullable();
      table.string('correlation_id').notNullable();
      table.timestamp('received_at').notNullable();
    });

    expect(await db.schema.hasColumn('payable_webhook_events', 'normalized_type')).toBe(false);
    expect(await db.schema.hasColumn('payable_webhook_events', 'data')).toBe(false);
    expect(await db.schema.hasColumn('payable_webhook_events', 'occurred_at')).toBe(false);

    await migrate(db);

    expect(await db.schema.hasColumn('payable_webhook_events', 'normalized_type')).toBe(true);
    expect(await db.schema.hasColumn('payable_webhook_events', 'data')).toBe(true);
    expect(await db.schema.hasColumn('payable_webhook_events', 'occurred_at')).toBe(true);
  });
});
