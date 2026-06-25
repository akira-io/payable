import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/infrastructure/audit/audit-service';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('audit chain ordering', () => {
  it('verifies a chain whose entries share a timestamp', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-06-22T00:00:00.000Z')));
    const audit = new AuditService(storage.auditLogs);

    for (let index = 0; index < 5; index += 1) {
      await audit.record({
        action: 'payment.refunded',
        resourceType: 'payment',
        resourceId: `pay_${index}`,
        correlationId: `corr_${index}`,
      });
    }

    expect(await audit.verify()).toBe(true);
    await db.destroy();
  });

  it('keeps a single linear chain under concurrent writes', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-06-22T00:00:00.000Z')));
    const audit = new AuditService(storage.auditLogs);

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        audit.record({
          action: 'payment.refunded',
          resourceType: 'payment',
          resourceId: `pay_${index}`,
          correlationId: `corr_${index}`,
        }),
      ),
    );

    const rows = (await db('payable_audit_logs').orderBy('sequence', 'asc')) as {
      sequence: number;
    }[];
    const sequences = rows.map((row) => row.sequence);
    expect(sequences).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(await audit.verify()).toBe(true);
    await db.destroy();
  });

  it('rejects a chain entry with a null hash or sequence', async () => {
    const db = createTestDb();
    await migrate(db);

    await expect(
      db('payable_audit_logs').insert({
        id: 'aud_1',
        correlation_id: 'corr_1',
        action: 'payment.refunded',
        resource_type: 'payment',
        resource_id: 'pay_1',
        hash: null,
        sequence: null,
        created_at: new Date('2026-06-22T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/NOT NULL/);
    await db.destroy();
  });
});
