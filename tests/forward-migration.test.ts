import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexAuditLogRepository } from '../src/infrastructure/storage/knex/repositories/knex-audit-log.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

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

    await migrate(db);

    expect(await db.schema.hasColumn('payable_webhook_events', 'normalized_type')).toBe(true);
    expect(await db.schema.hasColumn('payable_webhook_events', 'data')).toBe(true);
  });
});
