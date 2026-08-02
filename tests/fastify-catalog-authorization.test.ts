import Fastify, { type FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { ProductResource } from '../src/application/builders/product-resource';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';
import { seedAuthorizedCatalogProduct } from './support/seed-authorized-catalog';

type Mutation = {
  method: 'PATCH' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
  status: number;
};

const mutations = [
  { method: 'POST', url: '/payable/products', payload: { name: 'Pro' }, status: 201 },
  {
    method: 'PATCH',
    url: '/payable/products',
    payload: { providerProductId: 'prod_fake', name: 'Pro v2' },
    status: 200,
  },
  { method: 'POST', url: '/payable/products/prod_fake/activate', status: 200 },
  { method: 'POST', url: '/payable/products/prod_fake/archive', status: 200 },
  {
    method: 'POST',
    url: '/payable/prices',
    payload: { providerProductId: 'prod_fake', amount: { amount: 9900, currency: 'USD' } },
    status: 201,
  },
  { method: 'POST', url: '/payable/prices/price_fake/activate', status: 200 },
  { method: 'POST', url: '/payable/prices/price_fake/archive', status: 200 },
] as const;

function providerMutationCount(provider: FakeProvider): number {
  return [
    provider.lastCreateProduct,
    provider.lastUpdateProduct,
    provider.lastCreatePrice,
    ...provider.productActiveCalls,
    ...provider.priceActiveCalls,
  ].filter((mutation) => mutation !== undefined).length;
}

async function expectStorageUntouched(db: Knex): Promise<void> {
  for (const table of [
    'payable_products',
    'payable_prices',
    'payable_audit_logs',
    'payable_outbox_events',
  ]) {
    expect(await db(table)).toEqual([]);
  }
}

async function setup(allowed: boolean) {
  const db = createTestDb();
  await migrate(db);
  const provider = new FakeProvider();
  const authorization = {
    allowed,
    actorId: 'catalog-admin',
    actorType: 'service',
    tenantId: 'tenant-a',
  };
  const resolveAuthorization = vi.fn(() => authorization);
  const storage = new KnexStorageDriver(db, new FakeClock());
  await seedAuthorizedCatalogProduct(storage, allowed);
  const payable = createPayable({
    providers: { stripe: provider },
    storage,
    authorization: { enabled: true },
  });
  const app = Fastify();
  await app.register(
    createFastifyPayablePlugin(payable, {
      authenticate: async () => undefined,
      resolveAuthorization,
      resolveTenant: () => 'tenant-a',
    }),
    { prefix: '/payable' },
  );
  await app.ready();

  return { app, authorization, db, provider, resolveAuthorization };
}

function sendMutation(app: FastifyInstance, mutation: Mutation) {
  return app.inject({
    method: mutation.method,
    url: mutation.url,
    payload: mutation.payload ?? {},
  });
}

describe('fastify catalog authorization', () => {
  it('returns authorization denial before an invalid product idempotency key', async () => {
    const { app, db, provider } = await setup(false);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/payable/products',
        headers: { 'Idempotency-Key': ' invalid ' },
        payload: { name: 'Pro' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      expect(providerMutationCount(provider)).toBe(0);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it('returns missing price capability before an invalid idempotency key', async () => {
    const { app, db, provider } = await setup(true);
    provider.supportedCapabilities.delete('catalog');

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/payable/prices',
        headers: { 'Idempotency-Key': ' invalid ' },
        payload: {
          providerProductId: 'prod_fake',
          amount: { amount: 9900, currency: 'USD' },
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
      expect(providerMutationCount(provider)).toBe(0);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it.each(mutations)('denies $method $url before provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(false);

    try {
      const response = await sendMutation(app, mutation);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(providerMutationCount(provider)).toBe(0);
      await expectStorageUntouched(db);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it.each(mutations)('allows $method $url with one provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(true);

    try {
      const response = await sendMutation(app, mutation);

      expect(response.statusCode).toBe(mutation.status);
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(providerMutationCount(provider)).toBe(1);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it('forwards the product-create authorization object by identity', async () => {
    const { app, authorization, db } = await setup(true);
    const create = vi.spyOn(ProductResource.prototype, 'create');

    try {
      await app.inject({
        method: 'POST',
        url: '/payable/products',
        payload: { name: 'Pro' },
      });

      expect(create.mock.calls[0]?.[1]?.authorization).toBe(authorization);
    } finally {
      create.mockRestore();
      await app.close();
      await db.destroy();
    }
  });
});
