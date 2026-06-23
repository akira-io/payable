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
