import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { Payable } from '../src/payable';
import type { PayableHttpRequest } from '../src/presentation/nest/payable.constants';
import { PayableCatalogController } from '../src/presentation/nest/payable-catalog.controller';
import { payableErrorStatus } from '../src/presentation/shared/payable-http';
import {
  CATALOG_WRITE_CASES,
  type CatalogWriteCase,
  catalogKey,
  createCatalogHttpPayable,
  expectedStoredKey,
  HttpCatalogProvider,
  TrackingCatalogIdempotencyStore,
} from './support/catalog-http-idempotency';

function invokeCatalogMutation(
  controller: PayableCatalogController,
  request: PayableHttpRequest,
  catalogCase: CatalogWriteCase,
) {
  switch (catalogCase.action) {
    case 'product.create':
      return controller.createProduct(request, catalogCase.body);
    case 'product.update':
      return controller.updateProduct(request, catalogCase.body);
    case 'product.activate':
      return controller.activateProduct(request, 'prod_fake');
    case 'product.archive':
      return controller.archiveProduct(request, 'prod_fake');
    case 'price.create':
      return controller.createPrice(request, catalogCase.body);
    case 'price.activate':
      return controller.activatePrice(request, 'price_fake');
    case 'price.archive':
      return controller.archivePrice(request, 'price_fake');
    default:
      throw new Error(`Unsupported catalog action: ${catalogCase.action}`);
  }
}

function requestWithKey(key?: string): PayableHttpRequest {
  if (key === undefined) {
    return { headers: {} };
  }
  const request = {
    headers: { 'idempotency-key': key },
    rawHeaders: ['Idempotency-Key', key],
  };
  return request;
}

function createController(payable: Payable): PayableCatalogController {
  return new PayableCatalogController(payable, {});
}

async function caughtError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the catalog operation to fail');
}

describe('nest catalog idempotency', () => {
  it('forwards the exact key through all seven write handlers', async () => {
    const provider = new HttpCatalogProvider();
    const store = new TrackingCatalogIdempotencyStore();
    const controller = createController(createCatalogHttpPayable(provider, store));

    for (const catalogCase of CATALOG_WRITE_CASES) {
      await invokeCatalogMutation(
        controller,
        requestWithKey(catalogKey(catalogCase.action)),
        catalogCase,
      );
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
    const controller = createController(
      createCatalogHttpPayable(provider, new TrackingCatalogIdempotencyStore()),
    );
    await controller.createProduct(requestWithKey('conflict'), { name: 'Pro' });
    const conflict = await caughtError(() =>
      controller.createProduct(requestWithKey('conflict'), { name: 'Team' }),
    );
    expect(conflict).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(payableErrorStatus(conflict)).toBe(409);

    const blocked = provider.blockProductCreation();
    const first = controller.createProduct(requestWithKey('processing'), { name: 'Blocked' });
    await blocked.started;
    const inProgress = await caughtError(() =>
      controller.createProduct(requestWithKey('processing'), { name: 'Blocked' }),
    );
    expect(inProgress).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    expect(payableErrorStatus(inProgress)).toBe(409);
    blocked.release();
    await first;
  });

  it('rejects malformed keys and preserves requests without a key', async () => {
    const provider = new HttpCatalogProvider();
    const controller = createController(
      createCatalogHttpPayable(provider, new TrackingCatalogIdempotencyStore()),
    );
    const invalid = await caughtError(() =>
      controller.createProduct(requestWithKey(' bad '), { name: 'Pro' }),
    );
    expect(invalid).toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' });
    expect(payableErrorStatus(invalid)).toBe(400);
    await expect(
      controller.createProduct(requestWithKey(), { name: 'Pro' }),
    ).resolves.toMatchObject({ name: 'Pro' });
  });
});
