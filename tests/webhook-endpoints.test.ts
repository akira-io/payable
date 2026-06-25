import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;
let payable: Payable;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock());
  payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
});

afterEach(async () => {
  await db.destroy();
});

describe('webhook endpoint lifecycle (#460)', () => {
  it('registers an enabled endpoint with a generated signing secret', async () => {
    const endpoint = await payable.webhookEndpoints().register({
      url: 'https://hooks.acme.test/payable',
      events: ['invoice.paid', 'invoice.paid', ' subscription.updated '],
    });

    expect(endpoint.status).toBe('enabled');
    expect(endpoint.url).toBe('https://hooks.acme.test/payable');
    expect(endpoint.events).toEqual(['invoice.paid', 'subscription.updated']);
    expect(endpoint.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it('rejects a non-https endpoint url', async () => {
    await expect(
      payable
        .webhookEndpoints()
        .register({ url: 'http://hooks.acme.test', events: ['invoice.paid'] }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_ENDPOINT_INVALID_URL' });
  });

  it('rejects an endpoint with no subscribed events', async () => {
    await expect(
      payable.webhookEndpoints().register({ url: 'https://hooks.acme.test', events: ['  '] }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_ENDPOINT_EVENTS_REQUIRED' });
  });

  it('lists and disables endpoints scoped to the tenant', async () => {
    const a = await payable
      .webhookEndpoints('tenant-a')
      .register({ url: 'https://a.test/hook', events: ['invoice.paid'] });
    await payable
      .webhookEndpoints('tenant-b')
      .register({ url: 'https://b.test/hook', events: ['invoice.paid'] });

    expect(await payable.webhookEndpoints('tenant-a').list()).toHaveLength(1);
    expect(await payable.webhookEndpoints('tenant-b').list()).toHaveLength(1);

    const disabled = await payable.webhookEndpoints('tenant-a').disable(a.id);
    expect(disabled.status).toBe('disabled');
    expect(
      await storage.webhookEndpoints.listEnabledForEvent('invoice.paid', 'tenant-a'),
    ).toHaveLength(0);
  });

  it('matches enabled endpoints by subscribed event type', async () => {
    await payable
      .webhookEndpoints()
      .register({ url: 'https://a.test/hook', events: ['invoice.paid'] });
    await payable
      .webhookEndpoints()
      .register({ url: 'https://b.test/hook', events: ['subscription.updated'] });

    const matched = await storage.webhookEndpoints.listEnabledForEvent('invoice.paid', null);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.url).toBe('https://a.test/hook');
  });

  it('indexes endpoint event subscriptions in the join table', async () => {
    const endpoint = await payable
      .webhookEndpoints()
      .register({ url: 'https://a.test/hook', events: ['invoice.paid', 'subscription.updated'] });

    const rows = (await db('payable_webhook_endpoint_events')
      .where({ endpoint_id: endpoint.id })
      .orderBy('event_type', 'asc')) as { event_type: string }[];
    expect(rows.map((row) => row.event_type)).toEqual(['invoice.paid', 'subscription.updated']);

    const matched = await storage.webhookEndpoints.listEnabledForEvent(
      'subscription.updated',
      null,
    );
    expect(matched.map((endpointRow) => endpointRow.id)).toEqual([endpoint.id]);
  });

  it('requires a storage driver', () => {
    const noStorage = createPayable({ providers: { stripe: new FakeProvider() } });
    expect(() => noStorage.webhookEndpoints()).toThrow(PayableError);
  });
});
