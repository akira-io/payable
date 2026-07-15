import { describe, expect, it } from 'vitest';
import type { PinnedFetchInit } from '../src/application/services/webhook-delivery/webhook-delivery-service';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const PUBLIC_ADDRESS = '93.184.216.34';
const publicHost = async () => [PUBLIC_ADDRESS];

interface FetchCall {
  url: string;
  pinnedAddresses: string[] | undefined;
}

function recordingFetch(responder: () => { ok: boolean; status: number }) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      pinnedAddresses: (init as PinnedFetchInit | undefined)?.pinnedAddresses,
    });
    const { ok, status } = responder();
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

describe('webhook delivery DNS pinning', () => {
  it('hands the validated address set to the custom transport', async () => {
    const { db, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/pinned', events: ['invoice.paid'] });
    await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));
    const { calls, impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    await payable.deliverPendingWebhooks({ fetch: impl, resolveHost: publicHost });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pinnedAddresses).toEqual([PUBLIC_ADDRESS]);
    await db.destroy();
  });

  it('blocks a rebinding endpoint whose second DNS answer is private', async () => {
    const { db, clock, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/rebinding', events: ['invoice.paid'] });
    const first = await storage.outboxEvents.create({
      ...outboxEvent('invoice.paid.v1'),
      dedupeKey: 'rebind-1',
    });
    const answers = [[PUBLIC_ADDRESS], ['10.0.0.7']];
    const resolveHost = async () => answers.shift() ?? ['10.0.0.7'];
    const { calls, impl } = recordingFetch(() => ({ ok: false, status: 500 }));

    await payable.deliverPendingWebhooks({ fetch: impl, resolveHost });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pinnedAddresses).toEqual([PUBLIC_ADDRESS]);

    clock.advance(24 * 60 * 60 * 1000);
    await payable.deliverPendingWebhooks({ fetch: impl, resolveHost });
    expect(calls).toHaveLength(1);

    const deliveries = await storage.webhookDeliveries.listForEvent(first.id);
    expect(deliveries[0]?.status).toBe('failed');
    expect(deliveries[0]?.responseBody).toContain('blocked host');
    await db.destroy();
  });

  it('rejects a custom fetch without a custom resolver', async () => {
    const { db, payable } = await setup();
    const { impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    expect(() => payable.deliverPendingWebhooks({ fetch: impl })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_TRANSPORT_UNPINNABLE' }),
    );
    await db.destroy();
  });

  it('blocks delivery without an HTTP call when the endpoint host resolves to a private ip', async () => {
    const { db, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/rebind', events: ['invoice.paid'] });
    const event = await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));
    const { calls, impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    await payable.deliverPendingWebhooks({ fetch: impl, resolveHost: async () => ['127.0.0.1'] });

    expect(calls).toHaveLength(0);
    const deliveries = await storage.webhookDeliveries.listForEvent(event.id);
    expect(deliveries[0]?.status).toBe('failed');
    expect(deliveries[0]?.responseBody).toContain('blocked host');
    await db.destroy();
  });

  it('blocks delivery when the endpoint host resolves to nothing', async () => {
    const { db, storage, payable } = await setup();
    await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/empty', events: ['invoice.paid'] });
    const event = await storage.outboxEvents.create(outboxEvent('invoice.paid.v1'));
    const { calls, impl } = recordingFetch(() => ({ ok: true, status: 200 }));

    await payable.deliverPendingWebhooks({ fetch: impl, resolveHost: async () => [] });

    expect(calls).toHaveLength(0);
    const deliveries = await storage.webhookDeliveries.listForEvent(event.id);
    expect(deliveries[0]?.status).toBe('failed');
    expect(deliveries[0]?.responseBody).toContain('blocked host');
    await db.destroy();
  });
});
