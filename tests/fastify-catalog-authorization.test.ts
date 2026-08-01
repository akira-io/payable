import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { FakeProvider } from './support/fake-provider';

describe('fastify catalog authorization', () => {
  it('denies lifecycle requests before provider mutation', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      authorization: { enabled: true },
    });
    const app = Fastify();
    await app.register(
      createFastifyPayablePlugin(payable, {
        authenticate: async () => undefined,
        resolveAuthorization: () => ({ allowed: false, actorId: 'viewer' }),
      }),
      { prefix: '/payable' },
    );
    await app.ready();

    for (const url of [
      '/payable/products/prod_fake/activate',
      '/payable/products/prod_fake/archive',
      '/payable/prices/price_fake/activate',
      '/payable/prices/price_fake/archive',
    ]) {
      const response = await app.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
    }
    expect(provider.productActiveCalls).toEqual([]);
    expect(provider.priceActiveCalls).toEqual([]);
    await app.close();
  });
});
