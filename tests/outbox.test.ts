import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../src/infrastructure/outbox/outbox-service';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
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

const newOutbox = (eventType: string) => ({
  tenantId: null,
  correlationId: 'corr-1',
  eventType,
  eventVersion: 1,
  payload: { ref: eventType },
});

describe('OutboxService', () => {
  it('publishes pending events', async () => {
    await storage.outboxEvents.create(newOutbox('invoice.paid.v1'));
    const service = new OutboxService(storage.outboxEvents, clock);

    const result = await service.publishPending(async () => {});
    expect(result.published).toBe(1);
    expect(await countDuePendingOutbox(db, clock)).toBe(0);
  });

  it('deduplicates events sharing a dedupe key', async () => {
    const first = await storage.outboxEvents.create({
      ...newOutbox('invoice.paid.v1'),
      dedupeKey: 'webhook:evt_1:invoice.paid',
    });
    const second = await storage.outboxEvents.create({
      ...newOutbox('invoice.paid.v1'),
      dedupeKey: 'webhook:evt_1:invoice.paid',
    });

    expect(second.id).toBe(first.id);
    const rows = await db('payable_outbox_events').where({
      dedupe_key: 'webhook:evt_1:invoice.paid',
    });
    expect(rows).toHaveLength(1);
  });

  it('scopes the dedupe key to the tenant', async () => {
    const tenantA = await storage.outboxEvents.create({
      ...newOutbox('invoice.paid.v1'),
      tenantId: 'tenant-a',
      dedupeKey: 'webhook:shared:invoice.paid',
    });
    const tenantB = await storage.outboxEvents.create({
      ...newOutbox('invoice.paid.v1'),
      tenantId: 'tenant-b',
      dedupeKey: 'webhook:shared:invoice.paid',
    });
    const replayA = await storage.outboxEvents.create({
      ...newOutbox('invoice.paid.v1'),
      tenantId: 'tenant-a',
      dedupeKey: 'webhook:shared:invoice.paid',
    });

    expect(tenantB.id).not.toBe(tenantA.id);
    expect(replayA.id).toBe(tenantA.id);
    const rows = await db('payable_outbox_events').where({
      dedupe_key: 'webhook:shared:invoice.paid',
    });
    expect(rows).toHaveLength(2);
  });

  it('claims same-timestamp events in a deterministic id order', async () => {
    for (let i = 0; i < 6; i += 1) {
      await storage.outboxEvents.create(newOutbox(`evt.${i}.v1`));
    }

    const claimed = await storage.outboxEvents.claimPending(10);
    const ids = claimed.map((event) => event.id);

    expect(ids).toHaveLength(6);
    expect(ids).toEqual([...ids].sort());
  });

  it('does not let a busy tenant starve another in a single claim batch', async () => {
    for (let i = 0; i < 8; i += 1) {
      await storage.outboxEvents.create({ ...newOutbox(`busy.${i}.v1`), tenantId: 'tenant-busy' });
    }
    await storage.outboxEvents.create({ ...newOutbox('quiet.0.v1'), tenantId: 'tenant-quiet' });

    const claimed = await storage.outboxEvents.claimPending(2);
    const tenants = claimed.map((event) => event.tenantId);

    expect(claimed).toHaveLength(2);
    expect(tenants).toContain('tenant-quiet');
    expect(tenants).toContain('tenant-busy');
  });

  it('returns the claimed batch in fair round-robin order across tenants', async () => {
    await storage.outboxEvents.create({ ...newOutbox('a.0.v1'), tenantId: 'tenant-a' });
    clock.advance(1000);
    await storage.outboxEvents.create({ ...newOutbox('a.1.v1'), tenantId: 'tenant-a' });
    clock.advance(1000);
    await storage.outboxEvents.create({ ...newOutbox('b.0.v1'), tenantId: 'tenant-b' });
    clock.advance(1000);
    await storage.outboxEvents.create({ ...newOutbox('b.1.v1'), tenantId: 'tenant-b' });

    const claimed = await storage.outboxEvents.claimPending(10);

    expect(claimed.map((event) => event.tenantId)).toEqual([
      'tenant-a',
      'tenant-b',
      'tenant-a',
      'tenant-b',
    ]);
  });

  it('treats a non-future retry time as terminal failure instead of infinite retry', async () => {
    const event = await storage.outboxEvents.create(newOutbox('x.0.v1'));
    const [claimed] = await storage.outboxEvents.claimPending(10);
    const past = new Date(clock.now().getTime() - 1000);

    await storage.outboxEvents.markFailed(event.id, past, claimed?.lockToken ?? null);

    const row = await db('payable_outbox_events').where({ id: event.id }).first();
    expect(row.status).toBe('failed');
    expect(row.next_retry_at).toBeNull();
  });

  it('isolates a per-event store-write failure instead of aborting the batch', async () => {
    await storage.outboxEvents.create(newOutbox('a.v1'));
    await storage.outboxEvents.create(newOutbox('b.v1'));

    let failedId: string | undefined;
    const repo = Object.create(storage.outboxEvents);
    repo.markPublished = (id: string, token: string | null) => {
      failedId ??= id;
      return id === failedId
        ? Promise.reject(new Error('store write boom'))
        : storage.outboxEvents.markPublished(id, token);
    };
    const service = new OutboxService(repo, clock);

    const result = await service.publishPending(async () => {});
    expect(result.published).toBe(1);
  });

  it('does not dead-letter an already-delivered event when markPublished fails', async () => {
    const event = await storage.outboxEvents.create(newOutbox('invoice.paid.v1'));
    const repo = Object.create(storage.outboxEvents);
    repo.markPublished = () => Promise.reject(new Error('store write boom'));
    const service = new OutboxService(repo, clock, { maxAttempts: 1 });
    let deliveries = 0;

    const result = await service.publishPending(async () => {
      deliveries += 1;
    });

    expect(deliveries).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(result.retried).toBe(0);
    expect(result.published).toBe(0);
    expect((await db('payable_outbox_events').where({ id: event.id }).first())?.status).toBe(
      'processing',
    );
  });

  it('ignores a publish from a stale lock token', async () => {
    await storage.outboxEvents.create(newOutbox('invoice.paid.v1'));
    const [claimed] = await storage.outboxEvents.claimPending(10);
    if (!claimed) {
      throw new Error('expected a claimed event');
    }

    const staleUpdates = await storage.outboxEvents.markPublished(claimed.id, 'stale-token');
    expect(staleUpdates).toBe(0);
    expect((await db('payable_outbox_events').where({ id: claimed.id }).first())?.status).toBe(
      'processing',
    );

    const ownedUpdates = await storage.outboxEvents.markPublished(claimed.id, claimed.lockToken);
    expect(ownedUpdates).toBe(1);
    expect((await db('payable_outbox_events').where({ id: claimed.id }).first())?.status).toBe(
      'published',
    );
  });

  it('retries with backoff then dead-letters', async () => {
    const event = await storage.outboxEvents.create(newOutbox('subscription.created.v1'));
    const service = new OutboxService(storage.outboxEvents, clock, {
      maxAttempts: 2,
      backoffMs: 1000,
    });
    const failing = async () => {
      throw new Error('delivery failed');
    };

    const first = await service.publishPending(failing);
    expect(first.retried).toBe(1);
    expect(await countDuePendingOutbox(db, clock)).toBe(0);

    clock.advance(2000);
    expect(await countDuePendingOutbox(db, clock)).toBe(1);

    const second = await service.publishPending(failing);
    expect(second.deadLettered).toBe(1);
    const row = await db('payable_outbox_events').where({ id: event.id }).first();
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(2);
  });

  it('never schedules a retry beyond maxBackoffMs', async () => {
    await storage.outboxEvents.create(newOutbox('subscription.created.v1'));
    const service = new OutboxService(storage.outboxEvents, clock, {
      maxAttempts: 5,
      backoffMs: 100_000,
      maxBackoffMs: 1000,
      random: () => 1,
    });

    await service.publishPending(async () => {
      throw new Error('boom');
    });
    clock.advance(1000);
    expect(await countDuePendingOutbox(db, clock)).toBe(1);
  });

  it('logs the failure cause and caps the backoff with jitter', async () => {
    await storage.outboxEvents.create(newOutbox('subscription.created.v1'));
    const errors: string[] = [];
    const service = new OutboxService(storage.outboxEvents, clock, {
      maxAttempts: 2,
      backoffMs: 1000,
      maxBackoffMs: 1500,
      random: () => 1,
      logger: { debug() {}, info() {}, warn() {}, error: (m) => errors.push(m) },
    });

    await service.publishPending(async () => {
      throw new Error('delivery boom');
    });
    clock.advance(5000);
    await service.publishPending(async () => {
      throw new Error('delivery boom');
    });

    expect(errors).toContain('Outbox event dead-lettered');
  });
});
