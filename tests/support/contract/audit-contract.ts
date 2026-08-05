import { expect, it } from 'vitest';
import { AuditService } from '../../../src/infrastructure/audit/audit-service';
import type { ContractContext } from './harness';

export function registerAuditContract(ctx: ContractContext): void {
  it('filters audit entries with AND semantics and keeps descending sequence order', async () => {
    const { storage, clock } = ctx.harness();
    const audit = new AuditService(storage.auditLogs);

    await audit.record({
      tenantId: 'tenant-a',
      action: 'catalogue.product.created',
      resourceType: 'product',
      resourceId: 'product_1',
      correlationId: 'request_1',
      actorType: 'user',
      actorId: 'user_1',
    });
    clock.advance(1_000);
    await audit.record({
      tenantId: 'tenant-a',
      action: 'catalogue.price.created',
      resourceType: 'price',
      resourceId: 'price_1',
      correlationId: 'request_2',
      actorType: 'user',
      actorId: 'user_1',
    });
    clock.advance(1_000);
    await audit.record({
      tenantId: 'tenant-a',
      action: 'catalogue.price.archived',
      resourceType: 'price',
      resourceId: 'price_2',
      correlationId: 'request_3',
      actorType: 'system',
      actorId: 'worker_1',
    });
    await audit.record({
      tenantId: 'tenant-b',
      action: 'catalogue.price.created',
      resourceType: 'price',
      resourceId: 'price_1',
      correlationId: 'request_4',
      actorType: 'user',
      actorId: 'user_1',
    });

    const rows = await storage.auditLogs.list({
      tenantId: 'tenant-a',
      actions: ['catalogue.product.created', 'catalogue.price.created'],
      resourceTypes: ['product', 'price'],
      resourceIds: ['product_1', 'price_1'],
      correlationIds: ['request_1', 'request_2'],
      actorTypes: ['user'],
      actorIds: ['user_1'],
      createdAfter: new Date('2026-06-22T00:00:00.000Z'),
      createdBefore: new Date('2026-06-22T00:00:02.000Z'),
    });

    expect(rows.map(({ sequence }) => sequence)).toEqual([2, 1]);
    expect(rows.map(({ resourceId }) => resourceId)).toEqual(['price_1', 'product_1']);
    expect(rows.every(({ tenantId }) => tenantId === 'tenant-a')).toBe(true);
  });

  it('uses an exclusive sequence boundary for audit pagination', async () => {
    const { storage } = ctx.harness();
    const audit = new AuditService(storage.auditLogs);
    for (const resourceId of ['product_1', 'product_2', 'product_3']) {
      await audit.record({
        tenantId: 'tenant-a',
        action: 'catalogue.product.created',
        resourceType: 'product',
        resourceId,
        correlationId: `request_${resourceId}`,
      });
    }

    const rows = await storage.auditLogs.list({
      tenantId: 'tenant-a',
      beforeSequence: 3,
      limit: 2,
    });

    expect(rows.map(({ sequence }) => sequence)).toEqual([2, 1]);
  });

  it('combines legacy singular and plural audit filters with AND semantics', async () => {
    const { storage } = ctx.harness();
    const audit = new AuditService(storage.auditLogs);
    await audit.record({
      tenantId: 'tenant-a',
      action: 'catalogue.product.created',
      resourceType: 'product',
      resourceId: 'product_1',
      correlationId: 'request_1',
    });
    await audit.record({
      tenantId: 'tenant-a',
      action: 'catalogue.price.created',
      resourceType: 'price',
      resourceId: 'price_1',
      correlationId: 'request_2',
    });

    const rows = await storage.auditLogs.list({
      tenantId: 'tenant-a',
      resourceType: 'product',
      resourceTypes: ['price'],
    });

    expect(rows).toEqual([]);
  });
}
