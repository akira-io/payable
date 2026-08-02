import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import {
  CATALOG_WRITE_CASES,
  type CatalogHttpRequest,
  catalogKey,
  createCatalogHttpPayable,
  expectedStoredKey,
  HttpCatalogProvider,
  TrackingCatalogIdempotencyStore,
} from './support/catalog-http-idempotency';

async function createClient(provider: HttpCatalogProvider, store: TrackingCatalogIdempotencyStore) {
  const app = Fastify();
  await app.register(createFastifyPayablePlugin(createCatalogHttpPayable(provider, store)), {
    prefix: '/payable',
  });
  await app.ready();
  return {
    close: () => app.close(),
    send: async (catalogRequest: CatalogHttpRequest) => {
      const headers = catalogRequest.key ? { 'Idempotency-Key': catalogRequest.key } : undefined;
      const catalogResponse = await app.inject({
        method: catalogRequest.method,
        url: catalogRequest.path,
        headers,
        payload: catalogRequest.body,
      });
      return { body: catalogResponse.json(), status: catalogResponse.statusCode };
    },
  };
}

describe('fastify catalog idempotency', () => {
  it('forwards the exact key through all seven write routes', async () => {
    const provider = new HttpCatalogProvider();
    const store = new TrackingCatalogIdempotencyStore();
    const client = await createClient(provider, store);

    for (const catalogCase of CATALOG_WRITE_CASES) {
      const catalogResponse = await client.send({
        ...catalogCase,
        key: catalogKey(catalogCase.action),
      });
      expect(catalogResponse.status).toBe(catalogCase.expectedStatus);
    }

    expect([...new Set(store.searchedKeys)]).toEqual(
      await Promise.all(CATALOG_WRITE_CASES.map(({ action }) => expectedStoredKey(action))),
    );
    expect(provider.operationContexts).toHaveLength(7);
    expect(
      provider.operationContexts.every(({ idempotencyKey }) =>
        idempotencyKey?.startsWith('payable:catalog:v1:'),
      ),
    ).toBe(true);
    await client.close();
  });

  it('maps catalog conflicts and in-progress executions to 409', async () => {
    const provider = new HttpCatalogProvider();
    const client = await createClient(provider, new TrackingCatalogIdempotencyStore());
    await client.send({
      method: 'POST',
      path: '/payable/products',
      key: 'conflict',
      body: { name: 'Pro' },
    });
    const conflict = await client.send({
      method: 'POST',
      path: '/payable/products',
      key: 'conflict',
      body: { name: 'Team' },
    });
    expect(conflict).toMatchObject({
      status: 409,
      body: { error: 'IDEMPOTENCY_CONFLICT' },
    });

    const blocked = provider.blockProductCreation();
    const first = client.send({
      method: 'POST',
      path: '/payable/products',
      key: 'processing',
      body: { name: 'Blocked' },
    });
    await blocked.started;
    const inProgress = await client.send({
      method: 'POST',
      path: '/payable/products',
      key: 'processing',
      body: { name: 'Blocked' },
    });
    expect(inProgress).toMatchObject({
      status: 409,
      body: { error: 'IDEMPOTENCY_IN_PROGRESS' },
    });
    blocked.release();
    expect((await first).status).toBe(201);
    await client.close();
  });

  it('rejects malformed keys and preserves requests without a key', async () => {
    const provider = new HttpCatalogProvider();
    const client = await createClient(provider, new TrackingCatalogIdempotencyStore());
    const invalid = await client.send({
      method: 'POST',
      path: '/payable/products',
      key: ' bad ',
      body: { name: 'Pro' },
    });
    expect(invalid).toMatchObject({
      status: 400,
      body: { error: 'INVALID_IDEMPOTENCY_KEY' },
    });
    const compatible = await client.send({
      method: 'POST',
      path: '/payable/products',
      body: { name: 'Pro' },
    });
    expect(compatible.status).toBe(201);
    await client.close();
  });
});
