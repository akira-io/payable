import type { Server } from 'node:net';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ProductResource } from '../src/application/builders/product-resource';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';
import { createNestExpressApplication } from './support/nest-express-application';
import { seedAuthorizedCatalogProduct } from './support/seed-authorized-catalog';

type Mutation = {
  method: 'patch' | 'post';
  path: string;
  body?: Record<string, unknown>;
  status: number;
};

const mutations = [
  { method: 'post', path: '/products', body: { name: 'Pro' }, status: 201 },
  {
    method: 'patch',
    path: '/products',
    body: { providerProductId: 'prod_fake', name: 'Pro v2' },
    status: 200,
  },
  { method: 'post', path: '/products/prod_fake/activate', status: 200 },
  { method: 'post', path: '/products/prod_fake/archive', status: 200 },
  {
    method: 'post',
    path: '/prices',
    body: { providerProductId: 'prod_fake', amount: { amount: 9900, currency: 'USD' } },
    status: 201,
  },
  { method: 'post', path: '/prices/price_fake/activate', status: 200 },
  { method: 'post', path: '/prices/price_fake/archive', status: 200 },
] as const;

@Injectable()
class AllowGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

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
    tenant: { enabled: true },
    authorization: { enabled: true },
  });
  const app = await createNestExpressApplication(
    PayableModule.forRoot(payable, {
      authenticate: AllowGuard,
      resolveTenant: () => 'tenant-a',
      resolveAuthorization,
    }),
  );

  return { app, authorization, db, provider, resolveAuthorization };
}

function sendMutation(server: Server, mutation: Mutation): request.Test {
  return request(server)
    [mutation.method](mutation.path)
    .send(mutation.body ?? {});
}

describe('nest catalog authorization', () => {
  it('returns authorization denial before an invalid product idempotency key', async () => {
    const { app, db, provider } = await setup(false);

    try {
      const response = await request(app.getHttpServer())
        .post('/products')
        .set('Idempotency-Key', ' invalid ')
        .send({ name: 'Pro' });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
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
      const response = await request(app.getHttpServer())
        .post('/prices')
        .set('Idempotency-Key', ' invalid ')
        .send({
          providerProductId: 'prod_fake',
          amount: { amount: 9900, currency: 'USD' },
        });

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
      expect(providerMutationCount(provider)).toBe(0);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it.each(mutations)('denies $method $path before provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(false);

    try {
      const response = await sendMutation(app.getHttpServer(), mutation);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(providerMutationCount(provider)).toBe(0);
      await expectStorageUntouched(db);
    } finally {
      await app.close();
      await db.destroy();
    }
  });

  it.each(mutations)('allows $method $path with one provider mutation', async (mutation) => {
    const { app, db, provider, resolveAuthorization } = await setup(true);

    try {
      const response = await sendMutation(app.getHttpServer(), mutation);

      expect(response.status).toBe(mutation.status);
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
      await request(app.getHttpServer()).post('/products').send({ name: 'Pro' }).expect(201);

      expect(create.mock.calls[0]?.[1]?.authorization).toBe(authorization);
    } finally {
      create.mockRestore();
      await app.close();
      await db.destroy();
    }
  });
});
