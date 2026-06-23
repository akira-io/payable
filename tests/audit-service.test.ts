import { describe, expect, it } from 'vitest';
import { ListAuditLogsQuery } from '../src/application/queries/audit/list-audit-logs.query';
import { AuditService } from '../src/infrastructure/audit/audit-service';
import { FakeClock } from '../src/support/clock/fake-clock';
import { InMemoryAuditLogRepository } from './support/fakes';

describe('AuditService', () => {
  it('records an immutable entry with correlation id and mapped fields', async () => {
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const repository = new InMemoryAuditLogRepository(clock);
    const service = new AuditService(repository);

    const entry = await service.record({
      action: 'payment.charged',
      resourceType: 'payment',
      resourceId: 'pay_1',
      correlationId: 'corr_1',
      after: { amount: 9900, currency: 'USD' },
    });

    expect(entry.id).toMatch(/^audit_/);
    expect(entry.createdAt.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(entry.correlationId).toBe('corr_1');
    expect(entry.actorType).toBeNull();
    expect(entry.before).toBeNull();
    expect(entry.after).toEqual({ amount: 9900, currency: 'USD' });
    expect(repository.entries).toHaveLength(1);
  });

  it('chains entries and verifies the chain, detecting tampering', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const service = new AuditService(repository);

    const first = await service.record({
      action: 'payment.charged',
      resourceType: 'payment',
      resourceId: 'pay_1',
      correlationId: 'c1',
      after: { amount: 1000 },
    });
    const second = await service.record({
      action: 'payment.refunded',
      resourceType: 'payment',
      resourceId: 'pay_1',
      correlationId: 'c2',
      after: { amount: 500 },
    });

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.hash);
    expect(await service.verify()).toBe(true);

    repository.entries[1] = { ...second, after: { amount: 999999 } };
    expect(await service.verify()).toBe(false);
  });
});

describe('ListAuditLogsQuery', () => {
  it('filters by resource and limit', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const service = new AuditService(repository);
    await service.record({
      action: 'a',
      resourceType: 'payment',
      resourceId: 'p1',
      correlationId: 'c1',
    });
    await service.record({
      action: 'b',
      resourceType: 'refund',
      resourceId: 'r1',
      correlationId: 'c2',
    });
    await service.record({
      action: 'c',
      resourceType: 'payment',
      resourceId: 'p2',
      correlationId: 'c3',
    });

    const query = new ListAuditLogsQuery(repository);
    expect(await query.run({ resourceType: 'payment' })).toHaveLength(2);
    expect(await query.run({ correlationId: 'c2' })).toHaveLength(1);
    expect(await query.run({ limit: 1 })).toHaveLength(1);
  });

  it('forces the trusted tenant and ignores a tenant supplied in the query', async () => {
    const repository = new InMemoryAuditLogRepository(new FakeClock());
    const service = new AuditService(repository);
    await service.record({
      action: 'a',
      resourceType: 'payment',
      resourceId: 'p1',
      correlationId: 'c1',
      tenantId: 'tenant-a',
    });
    await service.record({
      action: 'b',
      resourceType: 'payment',
      resourceId: 'p2',
      correlationId: 'c2',
      tenantId: 'tenant-b',
    });

    const scoped = new ListAuditLogsQuery(repository, 'tenant-a');
    expect(await scoped.run({ tenantId: 'tenant-b' })).toHaveLength(1);
    expect((await scoped.run())[0]?.tenantId).toBe('tenant-a');
  });
});
