import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import type { NestPayableOptions } from '../src/presentation/nest/payable.constants';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { FakeProvider } from './support/fake-provider';
import { createNestExpressApplication } from './support/nest-express-application';

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return false;
  }
}

async function createApplication(provider: FakeProvider, options: NestPayableOptions = {}) {
  const payable = createPayable({ providers: { stripe: provider }, tenant: { enabled: true } });
  return createNestExpressApplication(PayableModule.forRoot(payable, options));
}

describe('nest catalog resources', () => {
  it('serves all eight catalog paths through Nest with bound queries and tenant resolution', async () => {
    const provider = new FakeProvider();
    const tenantIds: Array<string | null | undefined> = [];
    const app = await createApplication(provider, {
      resolveTenant: (httpRequest) => {
        const tenantId = httpRequest.headers['x-tenant-id'];
        tenantIds.push(typeof tenantId === 'string' ? tenantId : undefined);
        return typeof tenantId === 'string' ? tenantId : null;
      },
    });
    const server = app.getHttpServer();

    try {
      const products = await request(server)
        .get('/products')
        .set('x-tenant-id', 'tenant-a')
        .query({ limit: 25, cursor: 'products-cursor', active: false });
      expect(products.status).toBe(200);
      expect(products.body).toMatchObject({ data: [{ providerProductId: 'prod_fake' }] });
      expect(provider.lastListProducts).toEqual({
        limit: 25,
        cursor: 'products-cursor',
        active: false,
      });

      const product = await request(server)
        .get('/products/prod_fake')
        .set('x-tenant-id', 'tenant-a')
        .expect(200);
      expect(product.body).toMatchObject({ providerProductId: 'prod_fake' });

      const prices = await request(server).get('/prices').set('x-tenant-id', 'tenant-a').query({
        limit: 30,
        cursor: 'prices-cursor',
        active: false,
        providerProductId: 'prod_fake',
      });
      expect(prices.status).toBe(200);
      expect(prices.body).toMatchObject({ data: [{ providerPriceId: 'price_fake' }] });
      expect(provider.lastListPrices).toEqual({
        limit: 30,
        cursor: 'prices-cursor',
        active: false,
        providerProductId: 'prod_fake',
      });

      const price = await request(server)
        .get('/prices/price_fake')
        .set('x-tenant-id', 'tenant-a')
        .expect(200);
      expect(price.body).toMatchObject({ providerPriceId: 'price_fake' });

      for (const path of [
        '/products/prod_fake/activate',
        '/products/prod_fake/archive',
        '/prices/price_fake/activate',
        '/prices/price_fake/archive',
      ]) {
        await request(server).post(path).set('x-tenant-id', 'tenant-a').expect(200);
      }

      expect(provider.productActiveCalls.map(({ active }) => active)).toEqual([true, false]);
      expect(provider.priceActiveCalls.map(({ active }) => active)).toEqual([true, false]);
      expect(tenantIds).toEqual(Array.from({ length: 8 }, () => 'tenant-a'));
    } finally {
      await app.close();
    }
  });

  it('returns Nest-filtered catalog 404 and 422 responses', async () => {
    const provider = new FakeProvider();
    provider.retrieveProduct = async () => {
      throw new PayableError('Product not found', { code: 'PRODUCT_NOT_FOUND' });
    };
    const app = await createApplication(provider, { resolveTenant: () => 'tenant-a' });
    const server = app.getHttpServer();

    try {
      const missing = await request(server).get('/products/missing').expect(404);
      expect(missing.body).toMatchObject({ error: 'PRODUCT_NOT_FOUND' });

      const invalid = await request(server).get('/prices').query({ limit: 0 }).expect(422);
      expect(invalid.body).toMatchObject({ error: 'VALIDATION_FAILED' });
    } finally {
      await app.close();
    }
  });

  it('denies every catalog lifecycle request through the configured Nest guard', async () => {
    const provider = new FakeProvider();
    const app = await createApplication(provider, {
      authenticate: DenyGuard,
      resolveTenant: () => 'tenant-a',
    });
    const server = app.getHttpServer();

    try {
      for (const path of [
        '/products/prod_fake/activate',
        '/products/prod_fake/archive',
        '/prices/price_fake/activate',
        '/prices/price_fake/archive',
      ]) {
        const denied = await request(server).post(path);
        expect(denied.body).toMatchObject({ statusCode: 403, message: 'Forbidden resource' });
        expect(denied.status).toBe(403);
      }
      expect(provider.productActiveCalls).toEqual([]);
      expect(provider.priceActiveCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
