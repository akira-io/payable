import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { OutboxService } from '../src/infrastructure/outbox/outbox-service';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

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
    expect(await storage.outboxEvents.pullPending(10)).toHaveLength(0);
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
    expect(await storage.outboxEvents.pullPending(10)).toHaveLength(0);

    clock.advance(2000);
    expect(await storage.outboxEvents.pullPending(10)).toHaveLength(1);

    const second = await service.publishPending(failing);
    expect(second.deadLettered).toBe(1);
    const row = await db('payable_outbox_events').where({ id: event.id }).first();
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(2);
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
    expect(await storage.outboxEvents.pullPending(10)).toHaveLength(2);

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
});
