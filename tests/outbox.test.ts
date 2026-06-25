import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { OutboxService } from '../src/infrastructure/outbox/outbox-service';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
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

  it('ignores a publish from a stale lock token', async () => {
    await storage.outboxEvents.create(newOutbox('invoice.paid.v1'));
    const [claimed] = await storage.outboxEvents.claimPending(10);
    if (!claimed) {
      throw new Error('expected a claimed event');
    }

    await storage.outboxEvents.markPublished(claimed.id, 'stale-token');
    expect((await db('payable_outbox_events').where({ id: claimed.id }).first())?.status).toBe(
      'processing',
    );

    await storage.outboxEvents.markPublished(claimed.id, claimed.lockToken);
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

describe('webhook replay', () => {
  const verifyResult = {
    providerEventId: 'evt_1',
    type: 'invoice.paid',
    normalizedType: 'invoice.paid' as const,
    data: { id: 'in_1' },
  };

  it('re-runs the pipeline and is policy-gated', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const events = new InMemoryEventBus();
    let processed = 0;
    events.listen('webhook.processed', () => {
      processed += 1;
    });
    const payable = createPayable({ providers: { stripe: provider }, storage, events, clock });

    const received = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(processed).toBe(1);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(1);

    await payable.replayWebhook(received.webhookEventId, {
      allowed: true,
      actorType: 'user',
      actorId: 'admin-1',
    });
    expect(processed).toBe(2);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(2);
    expect(await countDuePendingOutbox(db, clock)).toBe(2);

    await expect(payable.replayWebhook(received.webhookEventId)).rejects.toThrow('not permitted');
    await expect(payable.replayWebhook(received.webhookEventId, { allowed: true })).rejects.toThrow(
      'not permitted',
    );
    await expect(
      payable.replayWebhook(received.webhookEventId, { allowed: false, actorId: 'admin-1' }),
    ).rejects.toThrow('not permitted');
    await expect(
      payable.replayWebhook('missing', { allowed: true, actorId: 'admin-1' }),
    ).rejects.toThrow('not found');
  });

  it('claims the event before reprocessing a previously failed replay', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_replay_failed',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_replay',
      receivedAt: clock.now(),
    });

    await payable.replayWebhook(event.id, { allowed: true, actorType: 'user', actorId: 'admin-1' });

    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processed');
  });

  it('does not replay an event another worker is actively processing', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_live_processing',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: { id: 'in_1' },
      headers: {},
      status: 'pending',
      correlationId: 'corr_live',
      receivedAt: clock.now(),
    });
    expect(await storage.webhookEvents.claim(event.id)).toBe(true);
    const auditBefore = (await storage.auditLogs.list({ resourceType: 'webhook_event' })).length;

    await payable.replayWebhook(event.id, { allowed: true, actorType: 'user', actorId: 'admin-1' });

    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processing');
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(
      auditBefore,
    );
  });
});
