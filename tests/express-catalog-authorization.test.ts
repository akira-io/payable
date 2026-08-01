import express from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ProductResource } from '../src/application/builders/product-resource';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';
import { seedAuthorizedCatalogProduct } from './support/seed-authorized-catalog';

type Mutation = {
  method: 'patch' | 'post';
  path: string;
  body?: Record<string, unknown>;
  status: number;
};

const mutations = [
  { method: 'post', path: '/payable/products', body: { name: 'Pro' }, status: 201 },
  {
    method: 'patch',
    path: '/payable/products',
    body: { providerProductId: 'prod_fake', name: 'Pro v2' },
    status: 200,
  },
  { method: 'post', path: '/payable/products/prod_fake/activate', status: 200 },
  { method: 'post', path: '/payable/products/prod_fake/archive', status: 200 },
  {
    method: 'post',
    path: '/payable/prices',
    body: { providerProductId: 'prod_fake', amount: { amount: 9900, currency: 'USD' } },
    status: 201,
  },
  { method: 'post', path: '/payable/prices/price_fake/activate', status: 200 },
  { method: 'post', path: '/payable/prices/price_fake/archive', status: 200 },
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
  const app = express();
  app.use(
    '/payable',
    createExpressPayableRoutes(payable, { resolveAuthorization, resolveTenant: () => 'tenant-a' }),
  );

  return { app, authorization, db, provider, resolveAuthorization };
}

function sendMutation(app: express.Express, mutation: Mutation): request.Test {
  return request(app)
    [mutation.method](mutation.path)
    .send(mutation.body ?? {});
}

describe('express catalog authorization', () => {
  it.each(mutations)('denies $method $path before provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(false);

    try {
      const response = await sendMutation(app, mutation);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(providerMutationCount(provider)).toBe(0);
      await expectStorageUntouched(db);
    } finally {
      await db.destroy();
    }
  });

  it.each(mutations)('allows $method $path with one provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(true);

    try {
      const response = await sendMutation(app, mutation);

      expect(response.status).toBe(mutation.status);
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(providerMutationCount(provider)).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('forwards the product-create authorization object by identity', async () => {
    const { app, authorization, db } = await setup(true);
    const create = vi.spyOn(ProductResource.prototype, 'create');

    try {
      await request(app).post('/payable/products').send({ name: 'Pro' }).expect(201);

      expect(create.mock.calls[0]?.[1]?.authorization).toBe(authorization);
    } finally {
      create.mockRestore();
      await db.destroy();
    }
  });
});
