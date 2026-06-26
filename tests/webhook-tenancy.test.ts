import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { TenantResolver } from '../src/domain/contracts/tenant-resolver.contract';
import type { VerifiedWebhook } from '../src/domain/dtos/webhook.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const verifyResult: VerifiedWebhook = {
  providerEventId: 'evt_1',
  type: 'invoice.paid',
  normalizedType: 'invoice.paid',
  data: { id: 'in_1' },
};

const headerResolver: TenantResolver = {
  resolve: (context) => context.headers['x-tenant-id'] ?? null,
};

let db: Knex;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock());
});

afterEach(async () => {
  await db.destroy();
});

function payableWithResolver() {
  const provider = new FakeProvider();
  provider.verifyResult = verifyResult;
  return createPayable({
    providers: { stripe: provider },
    storage,
    tenant: { enabled: true, resolver: headerResolver },
  });
}

describe('webhook tenancy', () => {
  it('resolves the tenant per consumer and isolates dedup across tenants', async () => {
    const payable = payableWithResolver();

    const acme = await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'acme' },
    });
    const globex = await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'globex' },
    });
    const acmeAgain = await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(acme.duplicate).toBe(false);
    expect(globex.duplicate).toBe(false);
    expect(acmeAgain.duplicate).toBe(true);
    expect(
      (await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1', 'acme'))?.tenantId,
    ).toBe('acme');
    expect(
      (await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1', 'globex'))?.tenantId,
    ).toBe('globex');
  });

  it('blocks cross-tenant replay', async () => {
    const payable = payableWithResolver();
    const received = await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'acme' },
    });

    await expect(
      payable.replayWebhook(received.webhookEventId, {
        allowed: true,
        actorId: 'admin',
        tenantId: 'globex',
      }),
    ).rejects.toThrow('not found');

    await expect(
      payable.replayWebhook(received.webhookEventId, {
        allowed: true,
        actorId: 'admin',
        tenantId: 'acme',
      }),
    ).resolves.toBeUndefined();
  });

  it('scopes markStatus to the tenant that owns the row', async () => {
    const acme = await payableWithResolver().receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'acme' },
    });

    await expect(
      storage.webhookEvents.markStatus(acme.webhookEventId, 'failed', null, 'globex'),
    ).rejects.toThrow('missing after write');

    const stillProcessed = await storage.webhookEvents.findById(acme.webhookEventId, 'acme');
    expect(stillProcessed?.status).toBe('processed');

    const flipped = await storage.webhookEvents.markStatus(
      acme.webhookEventId,
      'failed',
      null,
      'acme',
    );
    expect(flipped?.status).toBe('failed');
  });

  it('rejects a webhook when tenancy is enabled but no tenant resolves', async () => {
    const payable = payableWithResolver();
    await expect(
      payable.receiveWebhook({ payload: '{}', signature: 'sig', headers: {} }),
    ).rejects.toThrow('tenant id is required');
  });

  it('denies replay of a tenant-owned event when no tenant is supplied', async () => {
    const payable = payableWithResolver();
    const received = await payable.receiveWebhook({
      payload: '{}',
      signature: 'sig',
      headers: { 'x-tenant-id': 'acme' },
    });

    await expect(
      payable.replayWebhook(received.webhookEventId, { allowed: true, actorId: 'admin' }),
    ).rejects.toThrow('not permitted');
  });

  it('defaults to a null tenant when no resolver is configured', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage });

    const first = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    const second = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(
      (await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.tenantId,
    ).toBeNull();
  });
});
