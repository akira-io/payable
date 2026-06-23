import { describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('audit log list cap', () => {
  it('caps an unbounded list query at the default limit', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());

    for (let index = 0; index < 105; index += 1) {
      await storage.auditLogs.create({
        tenantId: null,
        correlationId: `corr_${index}`,
        actorType: null,
        actorId: null,
        action: 'payment.refunded',
        resourceType: 'payment',
        resourceId: `pay_${index}`,
        before: null,
        after: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
      });
    }

    const all = await storage.auditLogs.list({ resourceType: 'payment' });
    expect(all).toHaveLength(100);
    await db.destroy();
  });
});
