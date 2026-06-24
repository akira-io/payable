import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { redactHeaders } from '../src/support/redact-headers';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('redactHeaders', () => {
  it('drops sensitive headers case-insensitively and keeps the rest', () => {
    const result = redactHeaders({
      Authorization: 'Bearer secret',
      'Stripe-Signature': 'sig',
      cookie: 'session=abc',
      'content-type': 'application/json',
    });
    expect(result).toEqual({ 'content-type': 'application/json' });
  });

  it('drops custom signature, api-key, secret, and token headers', () => {
    const result = redactHeaders({
      'X-MyProvider-Signature': 'sig',
      'X-Api-Key': 'k',
      'X-Webhook-Secret': 's',
      'X-Auth-Token': 't',
      'content-type': 'application/json',
    });
    expect(result).toEqual({ 'content-type': 'application/json' });
  });
});

describe('webhook header persistence', () => {
  let db: Knex;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('does not persist credentials or the signature header', async () => {
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { authorization: 'Bearer secret', 'stripe-signature': 'sig', 'x-keep': 'yes' },
    });

    const event = await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1');
    expect(event?.headers).toEqual({ 'x-keep': 'yes' });
  });
});
