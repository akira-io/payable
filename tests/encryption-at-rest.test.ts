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
    const encryption = new NodeEncryptionDriver({ key: 'a-storage-key' });
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
