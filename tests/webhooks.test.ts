import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { DispatchWebhookJobAction } from '../src/application/actions/webhooks/dispatch-webhook-job.action';
import { ProcessWebhookAction } from '../src/application/actions/webhooks/process-webhook.action';
import type { WebhookDependencies } from '../src/application/builders/webhook-dependencies';
import { createPayable } from '../src/create-payable';
import type { QueueDriver, QueueJob } from '../src/domain/contracts/queue-driver.contract';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { StripeEventNormalizer } from '../src/infrastructure/providers/stripe/stripe-event-normalizer';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { SyncQueueDriver } from '../src/infrastructure/queue/sync/sync-queue-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { countDuePendingOutbox, createTestDb } from './support/knex';

class RecordingQueue extends SyncQueueDriver {
  readonly dispatched: Array<Record<string, unknown>> = [];

  override async dispatch<T>(job: QueueJob<T>): Promise<void> {
    this.dispatched.push(job.payload as Record<string, unknown>);
    await super.dispatch(job);
  }
}

const stripeWith = (event: unknown): Stripe =>
  ({ webhooks: { constructEventAsync: async () => event } }) as unknown as Stripe;

describe('StripeEventNormalizer', () => {
  it('maps provider event types to internal names', () => {
    const normalizer = new StripeEventNormalizer();
    expect(normalizer.normalize('checkout.session.completed')).toBe('checkout.completed');
    expect(normalizer.normalize('customer.subscription.deleted')).toBe('subscription.cancelled');
    expect(normalizer.normalize('unknown.event')).toBeNull();
  });

  it('logs a warning on an unmapped event type', () => {
    const warnings: Array<{ message: string; type?: unknown }> = [];
    const normalizer = new StripeEventNormalizer({
      debug() {},
      info() {},
      warn: (message, context) => warnings.push({ message, type: context?.type }),
      error() {},
    });
    expect(normalizer.normalize('brand.new.event')).toBeNull();
    expect(normalizer.normalize('invoice.paid')).toBe('invoice.paid');
    expect(warnings).toEqual([{ message: 'Unmapped Stripe event type', type: 'brand.new.event' }]);
  });
});

describe('StripeProvider.verifyWebhook', () => {
  it('verifies and normalizes a signed event', async () => {
    const provider = new StripeProvider(
      { secretKey: 'sk', webhookSecret: 'wh' },
      stripeWith({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1' } },
      }),
    );
    const verified = await provider.verifyWebhook({ payload: '{}', signature: 'sig' });
    expect(verified).toEqual({
      providerEventId: 'evt_1',
      type: 'checkout.session.completed',
      normalizedType: 'checkout.completed',
      data: { id: 'cs_1' },
    });
  });

  it('rejects an invalid signature', async () => {
    const failing = {
      webhooks: {
        constructEventAsync: async () => {
          throw new Error('bad signature');
        },
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, failing);
    await expect(
      provider.verifyWebhook({ payload: '{}', signature: 'bad' }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });
});

describe('DispatchWebhookJobAction', () => {
  it('uses the per-event id as the queue dedup key so tenants do not collide', async () => {
    const keys: string[] = [];
    const queue: QueueDriver = {
      dispatch: async (job) => {
        keys.push(job.idempotencyKey ?? '');
      },
      process: () => {},
    };
    const action = new DispatchWebhookJobAction(queue);

    await action.handle({
      providerName: 'stripe',
      webhookEventId: 'evt_row_a',
      providerEventId: 'evt_1',
      correlationId: 'c',
      tenantId: 'tenant-a',
    });
    await action.handle({
      providerName: 'stripe',
      webhookEventId: 'evt_row_b',
      providerEventId: 'evt_1',
      correlationId: 'c',
      tenantId: 'tenant-b',
    });

    expect(keys).toEqual(['evt_row_a', 'evt_row_b']);
  });
});

describe('payable.receiveWebhook', () => {
  it('stores, processes, and deduplicates a webhook', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const events = new InMemoryEventBus();
    const processed: string[] = [];
    events.listen('webhook.processed', (event) => {
      processed.push(event.name);
    });
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: provider }, storage, events });

    const first = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(first.duplicate).toBe(false);
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'processed',
    );
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(1);
    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    expect(processed).toEqual(['webhook.processed']);

    const second = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(second.duplicate).toBe(true);
    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    await db.destroy();
  });

  it('reprocesses a previously failed event on provider redelivery', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_retry',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_retry',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_retry',
      receivedAt: clock.now(),
    });

    const result = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(result.duplicate).toBe(true);
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_retry'))?.status).toBe(
      'processed',
    );
    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    await db.destroy();
  });

  it('signals a non-2xx when a redelivered event is still failed after dispatch', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_stuck',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const idleQueue: QueueDriver = {
      dispatch: async () => {},
      process: () => {},
    };
    const payable = createPayable({ providers: { stripe: provider }, storage, queue: idleQueue });

    await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_stuck',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_stuck',
      receivedAt: clock.now(),
    });

    await expect(payable.receiveWebhook({ payload: '{}', signature: 'sig' })).rejects.toMatchObject(
      {
        code: 'WEBHOOK_PROCESSING_FAILED',
      },
    );
    await db.destroy();
  });

  it('reports the event status on a successful receipt', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_ok',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    const result = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(result.status).toBe('processed');
    await db.destroy();
  });

  it('marks the event failed when processing throws', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_fail',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_fail',
      receivedAt: clock.now(),
    });

    const failing = Object.create(storage) as KnexStorageDriver;
    failing.transaction = () => Promise.reject(new Error('processing boom'));

    const deps: WebhookDependencies = {
      provider,
      providerName: 'stripe',
      storage: failing,
      queue: new SyncQueueDriver(),
      events: new InMemoryEventBus(),
      clock,
    };

    await expect(
      new ProcessWebhookAction(deps).handle({
        providerName: 'stripe',
        webhookEventId: event.id,
        providerEventId: 'evt_fail',
        correlationId: 'corr_fail',
        tenantId: null,
      }),
    ).rejects.toThrow('processing boom');

    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('failed');
    await db.destroy();
  });

  it('surfaces the processing error even when the failed-status write rejects', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_mask',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_mask',
      receivedAt: clock.now(),
    });

    const failingWebhookEvents = Object.create(storage.webhookEvents);
    failingWebhookEvents.markStatus = () => Promise.reject(new Error('status write boom'));
    const failing = Object.create(storage) as KnexStorageDriver;
    failing.transaction = () => Promise.reject(new Error('processing boom'));
    (failing as { webhookEvents: unknown }).webhookEvents = failingWebhookEvents;

    const deps: WebhookDependencies = {
      provider,
      providerName: 'stripe',
      storage: failing,
      queue: new SyncQueueDriver(),
      events: new InMemoryEventBus(),
      clock,
    };

    await expect(
      new ProcessWebhookAction(deps).handle({
        providerName: 'stripe',
        webhookEventId: event.id,
        providerEventId: 'evt_mask',
        correlationId: 'corr_mask',
        tenantId: null,
      }),
    ).rejects.toThrow('processing boom');
    await db.destroy();
  });

  it('claims the event atomically so concurrent workers process it once', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_race',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_race',
      receivedAt: clock.now(),
    });

    const deps: WebhookDependencies = {
      provider: new FakeProvider(),
      providerName: 'stripe',
      storage,
      queue: new SyncQueueDriver(),
      events: new InMemoryEventBus(),
      clock,
    };
    const action = new ProcessWebhookAction(deps);
    const job = {
      providerName: 'stripe',
      webhookEventId: event.id,
      providerEventId: 'evt_race',
      correlationId: 'corr_race',
      tenantId: null,
    };

    await Promise.all([action.handle(job), action.handle(job)]);

    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(1);
    await db.destroy();
  });

  it('only one of two workers wins the claim', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_claim',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_claim',
      receivedAt: new FakeClock().now(),
    });

    expect(await storage.webhookEvents.claim(event.id)).toEqual(expect.any(String));
    expect(await storage.webhookEvents.claim(event.id)).toBeNull();
    await db.destroy();
  });

  it('re-claims a processing event whose lock has expired', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_ttl',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_ttl',
      receivedAt: clock.now(),
    });

    expect(await storage.webhookEvents.claim(event.id)).toEqual(expect.any(String));
    expect(await storage.webhookEvents.claim(event.id)).toBeNull();

    clock.advance(300_001);
    expect(await storage.webhookEvents.claim(event.id)).toEqual(expect.any(String));
    await db.destroy();
  });

  it('markStatus scoped to a stale claim token does not clobber a re-claim', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_reclaim',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_reclaim',
      receivedAt: clock.now(),
    });

    const staleToken = await storage.webhookEvents.claim(event.id);
    expect(staleToken).toEqual(expect.any(String));

    clock.advance(300_001);
    const freshToken = await storage.webhookEvents.claim(event.id);
    expect(freshToken).toEqual(expect.any(String));
    expect(freshToken).not.toBe(staleToken);

    await storage.webhookEvents.markStatus(event.id, 'failed', null, null, staleToken);
    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processing');

    await storage.webhookEvents.markStatus(event.id, 'processed', clock.now(), null, freshToken);
    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processed');
    await db.destroy();
  });

  it('does not reprocess an already-processed event (idempotent delivery)', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_dup',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_dup',
      receivedAt: clock.now(),
    });

    const deps: WebhookDependencies = {
      provider,
      providerName: 'stripe',
      storage,
      queue: new SyncQueueDriver(),
      events: new InMemoryEventBus(),
      clock,
    };
    const action = new ProcessWebhookAction(deps);
    const job = {
      providerName: 'stripe',
      webhookEventId: event.id,
      providerEventId: 'evt_dup',
      correlationId: 'corr_dup',
      tenantId: null,
    };

    await action.handle(job);
    await action.handle(job);

    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(1);
    await db.destroy();
  });

  it('keeps decrypted webhook data out of the queue payload', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_pii',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1', customerEmail: 'secret@example.com' },
    };
    const queue = new RecordingQueue();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage, queue });

    const result = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(queue.dispatched).toHaveLength(1);
    const payload = queue.dispatched[0] ?? {};
    expect(payload).not.toHaveProperty('verified');
    expect(payload).not.toHaveProperty('data');
    expect(JSON.stringify(payload)).not.toContain('secret@example.com');
    expect(payload).toMatchObject({
      webhookEventId: result.webhookEventId,
      providerEventId: 'evt_pii',
      providerName: 'stripe',
    });

    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_pii'))?.status).toBe(
      'processed',
    );
    await db.destroy();
  });

  it('requires storage for webhook processing', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    await expect(payable.receiveWebhook({ payload: '{}', signature: 'sig' })).rejects.toThrow(
      'requires a storage driver',
    );
  });

  it('rejects a provider-less webhook when several providers are registered', async () => {
    const db = createTestDb();
    await migrate(db);
    const stripe = new FakeProvider();
    const paddle = new FakeProvider();
    stripe.verifyResult = {
      providerEventId: 'evt_amb',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe, paddle }, storage });

    await expect(payable.receiveWebhook({ payload: '{}', signature: 'sig' })).rejects.toThrow(
      'Multiple providers are registered',
    );

    const result = await payable.receiveWebhook({
      provider: 'stripe',
      payload: '{}',
      signature: 'sig',
    });
    expect(result.duplicate).toBe(false);
    await db.destroy();
  });
});
