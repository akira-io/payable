import { describe, expect, it } from 'vitest';
import { AuditResource, KnexAuditLogRepository, SystemClock } from '../src/index';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { PrismaAuditLogRepository } from '../src/infrastructure/storage/prisma';
import { createTestDb } from './support/knex';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';

describe('transaction-scoped audit composition', () => {
  it('rolls a Knex audit entry back with its host transaction', async () => {
    const db = createTestDb();
    await migrate(db);

    await expect(
      db.transaction(async (transaction) => {
        const repository = new KnexAuditLogRepository(transaction, new SystemClock());
        await new AuditResource(repository, 'tenant-a').record({
          action: 'host.setting.changed',
          resourceType: 'setting',
          resourceId: 'setting_1',
          correlationId: 'request_1',
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await db('payable_audit_logs')).toHaveLength(0);
    await db.destroy();
  });

  it('rolls a Prisma audit entry back with its host transaction', async () => {
    const prisma = await createPrismaTestClient();

    await expect(
      prisma.$transaction(async (transaction) => {
        const repository = new PrismaAuditLogRepository(transaction, new SystemClock());
        await new AuditResource(repository, 'tenant-a').record({
          action: 'host.setting.changed',
          resourceType: 'setting',
          resourceId: 'setting_1',
          correlationId: 'request_1',
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await prisma.payableAuditLog.findMany()).toHaveLength(0);
    await disconnectPrisma(prisma);
  }, 30_000);
});
