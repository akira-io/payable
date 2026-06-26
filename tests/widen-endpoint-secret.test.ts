import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { appliedMigrations } from '../src/infrastructure/storage/knex/migrations/migration-ledger';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('widen endpoint secret migration (#797)', () => {
  it('records the step once and stores an oversized secret', async () => {
    await db.schema.createTable('payable_webhook_endpoints', (table) => {
      table.uuid('id').primary();
      table.string('tenant_id').nullable();
      table.string('url').notNullable();
      table.text('events').notNullable();
      table.string('secret', 255).nullable();
      table.string('status').notNullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });

    await migrate(db);
    expect(await appliedMigrations(db)).toContain('004-widen-endpoint-secret');

    const longSecret = `whsec_${'a'.repeat(600)}`;
    await db('payable_webhook_endpoints').insert({
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: null,
      url: 'https://hooks.test/in',
      events: '[]',
      secret: longSecret,
      status: 'enabled',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const row = await db('payable_webhook_endpoints').first();
    expect(row.secret).toBe(longSecret);
  });

  it('runs idempotently', async () => {
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});
