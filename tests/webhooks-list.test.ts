import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { NewWebhookEvent } from '../src/domain/contracts/webhook-event-repository.contract';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

function event(overrides: Partial<NewWebhookEvent> = {}): NewWebhookEvent {
  return {
    tenantId: null,
    provider: 'stripe',
    providerEventId: globalThis.crypto.randomUUID(),
    type: 'payment_intent.succeeded',
    normalizedType: null,
    payload: '{}',
    data: {},
    headers: {},
    status: 'pending',
    correlationId: 'corr',
    receivedAt: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  };
}

describe('webhook events listing', () => {
  it('filters by provider, status and type', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    await storage.webhookEvents.create(event({ provider: 'stripe', status: 'processed' }));
    await storage.webhookEvents.create(event({ provider: 'paddle', status: 'pending' }));
    await storage.webhookEvents.create(
      event({ provider: 'stripe', status: 'failed', type: 'charge.refunded' }),
    );
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    const stripe = await payable.webhookEvents().list({ provider: 'stripe' });
    const failed = await payable.webhookEvents().list({ status: 'failed' });
    const refunds = await payable.webhookEvents().list({ type: 'charge.refunded' });

    expect(stripe).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(refunds).toHaveLength(1);
    await db.destroy();
  });

  it('scopes listing by tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    await storage.webhookEvents.create(event({ tenantId: 'tenant-a' }));
    await storage.webhookEvents.create(event({ tenantId: 'tenant-b' }));
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage,
      tenant: { enabled: true },
    });

    expect(await payable.webhookEvents('tenant-a').list()).toHaveLength(1);
    expect(await payable.webhookEvents('tenant-b').list()).toHaveLength(1);
    await db.destroy();
  });

  it('caps an unbounded list at the default limit', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    for (let index = 0; index < 105; index += 1) {
      await storage.webhookEvents.create(event());
    }
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    expect(await payable.webhookEvents().list()).toHaveLength(100);
    await db.destroy();
  });

  it('fetches a single event by id', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const created = await storage.webhookEvents.create(event());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    const found = await payable.webhookEvents().get(created.id);

    expect(found?.id).toBe(created.id);
    await db.destroy();
  });
});
