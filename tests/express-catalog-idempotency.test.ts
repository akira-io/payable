import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { validateCatalogIdempotencyKey } from '../src/application/services/catalog/catalog-idempotency-key';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { resolveCatalogIdempotencyHeader } from '../src/presentation/shared/catalog-idempotency';
import {
  CATALOG_WRITE_CASES,
  type CatalogHttpRequest,
  catalogKey,
  createCatalogHttpPayable,
  expectedStoredKey,
  HttpCatalogProvider,
  TrackingCatalogIdempotencyStore,
} from './support/catalog-http-idempotency';

function createClient(provider: HttpCatalogProvider, store: TrackingCatalogIdempotencyStore) {
  const app = express();
  app.use('/payable', createExpressPayableRoutes(createCatalogHttpPayable(provider, store)));
  return async (catalogRequest: CatalogHttpRequest) => {
    const pending =
      catalogRequest.method === 'POST'
        ? request(app).post(catalogRequest.path)
        : request(app).patch(catalogRequest.path);
    if (catalogRequest.key !== undefined) {
      pending.set('Idempotency-Key', catalogRequest.key);
    }
    if (catalogRequest.body) {
      pending.send(catalogRequest.body);
    }
    const catalogResponse = await pending;
    return { body: catalogResponse.body, status: catalogResponse.status };
  };
}

describe('express catalog idempotency', () => {
  it('resolves one opaque mixed-case header without splitting commas', () => {
    expect(resolveCatalogIdempotencyHeader({ headers: { 'IdEmPoTeNcY-KeY': 'opaque,part' } })).toBe(
      'opaque,part',
    );
    expect(resolveCatalogIdempotencyHeader({ headers: {} })).toBeUndefined();
  });

  it.each([
    { headers: { 'idempotency-key': ['one', 'two'] } },
    {
      headers: { 'idempotency-key': 'one' },
      rawHeaders: ['Idempotency-Key', 'one', 'idempotency-key', 'two'],
    },
  ])('preserves a repeated header as invalid input for resource validation', (headerInput) => {
    const extracted = resolveCatalogIdempotencyHeader(headerInput);
    expect(extracted).not.toBe('one');
    expect(() => validateCatalogIdempotencyKey(extracted)).toThrowError(
      expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
  });

  it.each([
    '',
    ' surrounded ',
    'x'.repeat(256),
  ])('extracts malformed header %j without validating it', (headerValue) => {
    expect(resolveCatalogIdempotencyHeader({ headers: { 'idempotency-key': headerValue } })).toBe(
      headerValue,
    );
  });

  it('forwards the exact key through all seven write routes', async () => {
    const provider = new HttpCatalogProvider();
    const store = new TrackingCatalogIdempotencyStore();
    const send = createClient(provider, store);

    for (const catalogCase of CATALOG_WRITE_CASES) {
      const catalogResponse = await send({
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
  });

  it('maps catalog conflicts and in-progress executions to 409', async () => {
    const provider = new HttpCatalogProvider();
    const store = new TrackingCatalogIdempotencyStore();
    const send = createClient(provider, store);
    await send({
      method: 'POST',
      path: '/payable/products',
      key: 'conflict',
      body: { name: 'Pro' },
    });
    const conflict = await send({
      method: 'POST',
      path: '/payable/products',
      key: 'conflict',
      body: { name: 'Team' },
    });
    expect(conflict).toMatchObject({ status: 409, body: { error: 'IDEMPOTENCY_CONFLICT' } });

    const blocked = provider.blockProductCreation();
    const first = send({
      method: 'POST',
      path: '/payable/products',
      key: 'processing',
      body: { name: 'Blocked' },
    });
    await blocked.started;
    const inProgress = await send({
      method: 'POST',
      path: '/payable/products',
      key: 'processing',
      body: { name: 'Blocked' },
    });
    expect(inProgress).toMatchObject({ status: 409, body: { error: 'IDEMPOTENCY_IN_PROGRESS' } });
    blocked.release();
    expect((await first).status).toBe(201);
  });

  it('rejects malformed keys and preserves requests without a key', async () => {
    const provider = new HttpCatalogProvider();
    const store = new TrackingCatalogIdempotencyStore();
    const send = createClient(provider, store);
    const invalid = await send({
      method: 'POST',
      path: '/payable/products',
      key: 'x'.repeat(256),
      body: { name: 'Pro' },
    });
    expect(invalid).toMatchObject({ status: 400, body: { error: 'INVALID_IDEMPOTENCY_KEY' } });
    const compatible = await send({
      method: 'POST',
      path: '/payable/products',
      body: { name: 'Pro' },
    });
    expect(compatible.status).toBe(201);
  });
});
