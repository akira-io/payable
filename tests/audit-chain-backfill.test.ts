import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexAuditLogRepository } from '../src/infrastructure/storage/knex/repositories/knex-audit-log.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

async function createPreHardeningTable(): Promise<void> {
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
}

function legacyRow(id: string, createdAt: string) {
  return {
    id,
    tenant_id: '',
    correlation_id: `corr-${id}`,
    action: 'payment.captured',
    resource_type: 'payment',
    resource_id: `pay-${id}`,
    created_at: createdAt,
  };
}

const liveEntry = {
  tenantId: null,
  correlationId: 'corr-live',
  actorType: null,
  actorId: null,
  action: 'payment.captured',
  resourceType: 'payment',
  resourceId: 'pay-live',
  before: null,
  after: null,
  metadata: null,
  ipAddress: null,
  userAgent: null,
};

describe('audit chain backfill (#766)', () => {
  it('assigns sequence and hash to legacy rows and makes the chain verifiable', async () => {
    await createPreHardeningTable();
    await db('payable_audit_logs').insert([
      legacyRow('a', '2026-06-20T00:00:00.000Z'),
      legacyRow('b', '2026-06-20T00:00:01.000Z'),
      legacyRow('c', '2026-06-20T00:00:02.000Z'),
    ]);
    await migrate(db);
    const repo = new KnexAuditLogRepository(db, new FakeClock(), 'audit-key');

    expect(await repo.verifyChain(null)).toBe(true);
    const filled = await repo.backfillChain(null);
    expect(filled).toBe(3);

    const rows = await db('payable_audit_logs').orderBy('sequence', 'asc');
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.hash !== null)).toBe(true);
    expect(await repo.verifyChain(null)).toBe(true);
    expect(await repo.backfillChain(null)).toBe(0);
  });

  it('appends legacy rows after an existing sequenced chain and stays verifiable', async () => {
    await createPreHardeningTable();
    await db('payable_audit_logs').insert(legacyRow('legacy', '2026-06-19T00:00:00.000Z'));
    await migrate(db);
    const repo = new KnexAuditLogRepository(db, new FakeClock(), 'audit-key');
    await repo.create(liveEntry);

    const filled = await repo.backfillChain(null);
    expect(filled).toBe(1);
    expect(await repo.verifyChain(null)).toBe(true);
  });
});
