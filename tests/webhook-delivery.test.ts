import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { signWebhookPayload } from '../src/support/hash/webhook-signature';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function recordingFetch(responder: (url: string) => { ok: boolean; status: number }) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), headers, body: String(init?.body ?? '') });
    const { ok, status } = responder(String(url));
    return { ok, status, text: async () => '' } as Response;
  }) as typeof globalThis.fetch;
  return { calls, impl };
}

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-25T00:00:00.000Z'));
  const storage = new KnexStorageDriver(db, clock);
  const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });
  return { db, clock, storage, payable };
}

const outboxEvent = (eventType: string) => ({
  tenantId: null,
  correlationId: 'corr-1',
  eventType,
  eventVersion: 1,
  payload: { invoiceId: 'in_1' },
});

describe('outbound webhook delivery', () => {
  it('signs and posts a subscribed event to an enabled endpoint, then records it', async () => {
    const { db, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/in', events: ['invoice.paid'] });
    const event = await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));
    const { calls, impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    const result = await payable.deliverPendingWebhooks({ fetch: impl });

    expect(result.published).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.test/in');
    expect(calls[0]?.headers['payable-event-type']).toBe('invoice.paid');
    expect(calls[0]?.headers['payable-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    const deliveries = await storage.webhookDeliveries.listForEvent(event.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('delivered');
    expect(deliveries[0]?.responseCode).toBe(200);
    await db.destroy();
  });

  it('does not redeliver an endpoint that already succeeded when another endpoint is retried', async () => {
    const { db, clock, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/ok', events: ['invoice.paid'] });
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/flaky', events: ['invoice.paid'] });
    const event = await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));

    const first = recordingFetch((url) => ({
      ok: url.endsWith('/ok'),
      status: url.endsWith('/ok') ? 200 : 500,
    }));
    const failed = await payable.deliverPendingWebhooks({
      fetch: first.impl,
      outbox: { maxAttempts: 3 },
    });
    expect(failed.retried).toBe(1);
    expect(first.calls).toHaveLength(2);

    clock.advance(5000);
    const second = recordingFetch(() => ({ ok: true, status: 200 }));
    const recovered = await payable.deliverPendingWebhooks({
      fetch: second.impl,
      outbox: { maxAttempts: 3 },
    });

    expect(recovered.published).toBe(1);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.url).toBe('https://hooks.test/flaky');

    const deliveries = await storage.webhookDeliveries.listForEvent(event.id);
    expect(deliveries.every((entry) => entry.status === 'delivered')).toBe(true);
    await db.destroy();
  });

  it('publishes without any HTTP call when no endpoint subscribes to the event', async () => {
    const { db, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/x', events: ['payment.succeeded'] });
    await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));
    const { calls, impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    const result = await payable.deliverPendingWebhooks({ fetch: impl });

    expect(result.published).toBe(1);
    expect(calls).toHaveLength(0);
    await db.destroy();
  });
});

describe('signWebhookPayload', () => {
  it('produces a deterministic 64-char hex HMAC-SHA256', async () => {
    const a = await signWebhookPayload('whsec_secret', '1750000000.{"a":1}');
    const b = await signWebhookPayload('whsec_secret', '1750000000.{"a":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const different = await signWebhookPayload('whsec_other', '1750000000.{"a":1}');
    expect(different).not.toBe(a);
  });
});
