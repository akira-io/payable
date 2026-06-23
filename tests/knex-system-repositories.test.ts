import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { countDuePendingOutbox, createTestDb } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
});

afterEach(async () => {
  await db.destroy();
});

describe('KnexIdempotencyRepository', () => {
  it('persists, replays, and completes a record', async () => {
    const store = new KnexIdempotencyRepository(db, clock);
    await store.put({
      key: 'charge:1',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: 'hash-1',
      response: null,
      status: 'processing',
      lockedUntil: new Date('2026-06-22T00:00:30.000Z'),
      expiresAt: null,
    });

    const found = await store.find('charge:1');
    expect(found?.status).toBe('processing');
    expect(found?.requestHash).toBe('hash-1');

    await store.markCompleted('charge:1', { paymentId: 'pay_1' });
    const completed = await store.find('charge:1');
    expect(completed?.status).toBe('completed');
    expect(completed?.response).toEqual({ paymentId: 'pay_1' });
  });
});

describe('KnexAuditLogRepository', () => {
  it('stores immutable entries and lists by resource', async () => {
    await storage.auditLogs.create({
      tenantId: null,
      correlationId: 'corr_1',
      actorType: null,
      actorId: null,
      action: 'payment.charged',
      resourceType: 'payment',
      resourceId: 'pay_1',
      before: null,
      after: { amount: 9900 },
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });

    const logs = await storage.auditLogs.list({ resourceType: 'payment' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.correlationId).toBe('corr_1');
    expect(logs[0]?.after).toEqual({ amount: 9900 });
  });
});

describe('KnexOutboxEventRepository', () => {
  it('creates pending events and tracks delivery state', async () => {
    const event = await storage.outboxEvents.create({
      tenantId: null,
      correlationId: 'corr_1',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { invoiceId: 'in_1' },
    });
    expect(event.status).toBe('pending');
    expect(event.attempts).toBe(0);

    expect(await countDuePendingOutbox(db, clock)).toBe(1);

    await storage.outboxEvents.markFailed(event.id, null);
    expect(await countDuePendingOutbox(db, clock)).toBe(0);
    const row = await db('payable_outbox_events').where({ id: event.id }).first();
    expect(row?.attempts).toBe(1);

    await storage.outboxEvents.markPublished(event.id);
    const published = await db('payable_outbox_events').where({ id: event.id }).first();
    expect(published?.status).toBe('published');
  });
});
