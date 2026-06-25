import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

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
