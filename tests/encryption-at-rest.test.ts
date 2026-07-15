import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { NodeEncryptionDriver } from '../src/infrastructure/encryption/node-encryption-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
});

afterEach(async () => {
  await db.destroy();
});

describe('webhook encryption at rest', () => {
  it('stores the payload and data as ciphertext and decrypts on read', async () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock(), encryption);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1', email: 'user@example.com' },
    };
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable.receiveWebhook({
      payload: '{"id":"evt_1","email":"user@example.com"}',
      signature: 'sig',
      headers: { 'x-trace-id': 'trace-abc' },
    });

    const raw = await db('payable_webhook_events').where({ provider_event_id: 'evt_1' }).first();
    expect(raw?.payload).not.toContain('user@example.com');
    expect(raw?.payload).not.toContain('evt_1');
    expect(raw?.data).not.toContain('in_1');
    expect(raw?.headers).not.toContain('trace-abc');

    const event = await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1');
    expect(event?.payload).toBe('{"id":"evt_1","email":"user@example.com"}');
    expect(event?.data).toEqual({ id: 'in_1', email: 'user@example.com' });
    expect(event?.headers).toEqual({ 'x-trace-id': 'trace-abc' });
  });

  it('stores the webhook endpoint signing secret as ciphertext and decrypts on read', async () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock(), encryption);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });

    const endpoint = await payable
      .webhookEndpoints()
      .register({ url: 'https://hooks.test/in', events: ['invoice.paid'] });

    const raw = await db('payable_webhook_endpoints').where({ id: endpoint.id }).first();
    expect(raw?.secret).not.toBe(endpoint.secret);
    expect(raw?.secret).not.toContain('whsec_');

    const reloaded = await storage.webhookEndpoints.findById(endpoint.id);
    expect(reloaded?.secret).toBe(endpoint.secret);
  });

  it('protects every persisted copy of a processed webhook', async () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock(), encryption);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_copies',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_copies', email: 'copies@example.com' },
    };
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable.receiveWebhook({ payload: '{"id":"evt_copies"}', signature: 'sig' });

    const outbox = await db('payable_outbox_events').first();
    expect(outbox?.payload).not.toContain('copies@example.com');
    expect(outbox?.payload).not.toContain('in_copies');
    const [event] = await storage.outboxEvents.claimPending(1);
    expect(event?.payload).toMatchObject({
      providerEventId: 'evt_copies',
      data: { id: 'in_copies', email: 'copies@example.com' },
    });

    const audits = await db('payable_audit_logs');
    for (const audit of audits) {
      expect(audit.after ?? '').not.toContain('copies@example.com');
      expect(audit.before ?? '').not.toContain('copies@example.com');
    }
  });

  it('stores webhook delivery payloads as ciphertext and decrypts on read', async () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock(), encryption);

    await storage.webhookDeliveries.record({
      tenantId: null,
      endpointId: 'ep_1',
      eventId: 'evt_out_1',
      eventType: 'invoice.paid',
      payload: { providerEventId: 'evt_out_1', data: { email: 'deliver@example.com' } },
      status: 'delivered',
      attempts: 1,
      responseCode: 200,
      responseBody: null,
    });

    const raw = await db('payable_webhook_deliveries').first();
    expect(raw?.payload).not.toContain('deliver@example.com');
    const [delivery] = await storage.webhookDeliveries.listForEvent('evt_out_1');
    expect(delivery?.payload).toMatchObject({ data: { email: 'deliver@example.com' } });
  });

  it('wires createPayable({ encryption }) into a supporting storage driver', async () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock());
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_wired',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_wired', email: 'wired@example.com' },
    };
    const payable = createPayable({ providers: { stripe: provider }, storage, encryption });

    await payable.receiveWebhook({ payload: '{"id":"evt_wired"}', signature: 'sig' });

    const raw = await db('payable_webhook_events')
      .where({ provider_event_id: 'evt_wired' })
      .first();
    expect(raw?.data).not.toContain('wired@example.com');
    const outbox = await db('payable_outbox_events').first();
    expect(outbox?.payload).not.toContain('wired@example.com');
  });

  it('rejects encryption without a storage driver', () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    expect(() => createPayable({ providers: { stripe: new FakeProvider() }, encryption })).toThrow(
      /requires a storage driver/,
    );
  });

  it('rejects encryption when the storage driver cannot attach it', () => {
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
    const storage = new KnexStorageDriver(db, new FakeClock());
    const bare = Object.create(storage) as KnexStorageDriver;
    Object.defineProperty(bare, 'attachEncryption', { value: undefined });

    expect(() =>
      createPayable({ providers: { stripe: new FakeProvider() }, storage: bare, encryption }),
    ).toThrow(/does not support attaching encryption/);
  });

  it('leaves data plaintext when no encryption is configured', async () => {
    const storage = new KnexStorageDriver(db, new FakeClock());
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_2',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_2' },
    };
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable.receiveWebhook({ payload: '{"id":"evt_2"}', signature: 'sig' });

    const raw = await db('payable_webhook_events').where({ provider_event_id: 'evt_2' }).first();
    expect(raw?.payload).toBe('{"id":"evt_2"}');
    expect(raw?.data).toContain('in_2');
  });
});
