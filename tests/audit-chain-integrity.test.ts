import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewAuditLog } from '../src/domain/contracts/audit-log-repository.contract';
import { auditEntryHash } from '../src/infrastructure/audit/audit-chain';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock());
});

afterEach(async () => {
  await db.destroy();
});

function entry(index: number): NewAuditLog {
  return {
    tenantId: null,
    correlationId: `c${index}`,
    actorType: null,
    actorId: null,
    action: 'payment.charged',
    resourceType: 'payment',
    resourceId: `pay_${index}`,
    before: null,
    after: null,
    metadata: null,
    ipAddress: null,
    userAgent: null,
  };
}

describe('audit chain integrity', () => {
  it('rejects a self-consistent chain whose genesis is forged to a non-null hash', async () => {
    const first = entry(1);
    const second = entry(2);
    const forgedGenesis = 'forged-genesis-hash';
    const firstHash = await auditEntryHash(forgedGenesis, first);
    const secondHash = await auditEntryHash(firstHash, second);
    const createdAt = new FakeClock().now().toISOString();

    await db('payable_audit_logs').insert([
      {
        id: 'a1',
        sequence: 1,
        tenant_id: '',
        correlation_id: first.correlationId,
        action: first.action,
        resource_type: first.resourceType,
        resource_id: first.resourceId,
        previous_hash: forgedGenesis,
        hash: firstHash,
        created_at: createdAt,
      },
      {
        id: 'a2',
        sequence: 2,
        tenant_id: '',
        correlation_id: second.correlationId,
        action: second.action,
        resource_type: second.resourceType,
        resource_id: second.resourceId,
        previous_hash: firstHash,
        hash: secondHash,
        created_at: createdAt,
      },
    ]);

    expect(await storage.auditLogs.verifyChain(null)).toBe(false);
  });

  it('verifies past the page boundary and detects tampering in the oldest entry', async () => {
    for (let index = 1; index <= 1001; index += 1) {
      await storage.auditLogs.create(entry(index));
    }
    expect(await storage.auditLogs.verifyChain(null)).toBe(true);

    await db('payable_audit_logs')
      .where({ sequence: 1 })
      .update({ after: JSON.stringify({ tampered: true }) });
    expect(await storage.auditLogs.verifyChain(null)).toBe(false);
  });

  it('allocates contiguous sequences under concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) => storage.auditLogs.create(entry(index))),
    );

    expect(await storage.auditLogs.verifyChain(null)).toBe(true);
    const rows = (await db('payable_audit_logs').orderBy('sequence', 'asc')) as {
      sequence: number;
    }[];
    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
  });
});
