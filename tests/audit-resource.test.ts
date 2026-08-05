import { describe, expect, it } from 'vitest';
import { AuditResource } from '../src/application/builders/audit-resource';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { InMemoryAuditLogRepository } from './support/fakes';
import { createTestDb } from './support/knex';

describe('AuditResource', () => {
  it('records against the tenant bound to the resource', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const resource = new AuditResource(repository, 'tenant-a');

    const entry = await resource.record({
      action: 'catalogue.product.created',
      resourceType: 'product',
      resourceId: 'prod_1',
      correlationId: 'req_1',
      after: { name: 'Starter' },
    });

    expect(entry.tenantId).toBe('tenant-a');
    expect(entry.sequence).toBe(1);
    expect(repository.entries).toHaveLength(1);
  });

  it('paginates in descending sequence order without overlap', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const resource = new AuditResource(repository, 'tenant-a');
    for (const id of ['prod_1', 'prod_2', 'prod_3']) {
      await resource.record({
        action: 'catalogue.product.created',
        resourceType: 'product',
        resourceId: id,
        correlationId: `req_${id}`,
      });
    }

    const first = await resource.list({ limit: 2 });
    const second = await resource.list({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.data.map(({ sequence }) => sequence)).toEqual([3, 2]);
    expect(second.data.map(({ sequence }) => sequence)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a malformed page cursor', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');

    await expect(resource.list({ cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'AUDIT_CURSOR_INVALID',
    });
  });

  it('rejects an unsupported cursor version', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');
    const cursor = btoa(JSON.stringify({ v: 2, before: 1 })).replaceAll('=', '');

    await expect(resource.list({ cursor })).rejects.toMatchObject({
      code: 'AUDIT_CURSOR_INVALID',
    });
  });

  it('rejects empty plural filters instead of widening the query', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');

    await expect(resource.list({ resourceIds: [] })).rejects.toMatchObject({
      code: 'AUDIT_INPUT_INVALID',
      context: { field: 'resourceIds' },
    });
  });

  it('rejects contradictory date bounds', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');

    await expect(
      resource.list({
        createdAfter: new Date('2026-08-06T00:00:00.000Z'),
        createdBefore: new Date('2026-08-05T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_INPUT_INVALID', context: { field: 'createdBefore' } });
  });

  it('rejects entries with identifiers beyond their documented bounds', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');

    await expect(
      resource.record({
        action: 'a'.repeat(129),
        resourceType: 'product',
        resourceId: 'product_1',
        correlationId: 'request_1',
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_INPUT_INVALID', context: { field: 'action' } });
  });

  it('rejects snapshots that cannot be serialized as JSON', async () => {
    const resource = new AuditResource(new InMemoryAuditLogRepository(new FakeClock()), 'tenant-a');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(
      resource.record({
        action: 'catalogue.product.created',
        resourceType: 'product',
        resourceId: 'product_1',
        correlationId: 'request_1',
        after: cyclic,
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_INPUT_INVALID', context: { field: 'after' } });
  });

  it('rejects unsequenced repository rows instead of fabricating order', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const resource = new AuditResource(repository, 'tenant-a');
    await resource.record({
      action: 'catalogue.product.created',
      resourceType: 'product',
      resourceId: 'product_1',
      correlationId: 'request_1',
    });
    const entry = repository.entries[0];
    if (entry) {
      repository.entries[0] = { ...entry, sequence: 0 };
    }

    await expect(resource.list()).rejects.toMatchObject({ code: 'AUDIT_SEQUENCE_INVALID' });
  });

  it('exposes a tenant-bound resource while preserving the legacy reader', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({
      tenant: { enabled: true },
      providers: { fake: new FakeProvider() },
      storage,
    });

    expect(() => payable.audit()).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    await payable.audit('tenant-a').record({
      action: 'catalogue.product.created',
      resourceType: 'product',
      resourceId: 'product_1',
      correlationId: 'request_1',
    });

    expect((await payable.audit('tenant-a').list()).data).toHaveLength(1);
    expect(await payable.auditLogs('tenant-a').run()).toHaveLength(1);
    await db.destroy();
  });
});
