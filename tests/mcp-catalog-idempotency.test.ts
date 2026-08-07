import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { PriceResource } from '../src/application/builders/price-resource';
import { ProductResource } from '../src/application/builders/product-resource';
import type { Payable } from '../src/payable';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import {
  createCatalogHttpPayable,
  HttpCatalogProvider,
  TrackingCatalogIdempotencyStore,
} from './support/catalog-http-idempotency';

async function connect(payable: Payable): Promise<Client> {
  const server = createPayableMcpServer(payable, { defaultProvider: 'stripe' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'catalog-idempotency-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parse(result: unknown): unknown {
  const toolResult = CallToolResultSchema.parse(result);
  const block = toolResult.content[0];
  if (block?.type !== 'text') {
    throw new Error('Expected a text result');
  }
  return JSON.parse(block.text);
}

describe('MCP catalog idempotency', () => {
  it('forwards the caller key to every catalog mutation resource', async () => {
    const provider = new HttpCatalogProvider();
    const payable = createCatalogHttpPayable(provider, new TrackingCatalogIdempotencyStore());
    const client = await connect(payable);
    const productCreate = vi.spyOn(ProductResource.prototype, 'create');
    const productUpdate = vi.spyOn(ProductResource.prototype, 'update');
    const productActivate = vi.spyOn(ProductResource.prototype, 'activate');
    const productArchive = vi.spyOn(ProductResource.prototype, 'archive');
    const priceCreate = vi.spyOn(PriceResource.prototype, 'create');
    const priceActivate = vi.spyOn(PriceResource.prototype, 'activate');
    const priceArchive = vi.spyOn(PriceResource.prototype, 'archive');
    const idempotencyKey = 'catalog-request-1';

    await client.callTool({
      name: 'product_create',
      arguments: { name: 'Pro', idempotencyKey },
    });
    await client.callTool({
      name: 'product_update',
      arguments: { providerProductId: 'prod_fake', name: 'Pro v2', idempotencyKey },
    });
    await client.callTool({
      name: 'price_create',
      arguments: {
        providerProductId: 'prod_fake',
        unitAmount: { amount: 9900, currency: 'USD' },
        idempotencyKey,
      },
    });
    await client.callTool({
      name: 'product_activate',
      arguments: { id: 'prod_fake', idempotencyKey },
    });
    await client.callTool({
      name: 'product_archive',
      arguments: { id: 'prod_fake', idempotencyKey },
    });
    await client.callTool({
      name: 'price_activate',
      arguments: { id: 'price_fake', idempotencyKey },
    });
    await client.callTool({
      name: 'price_archive',
      arguments: { id: 'price_fake', idempotencyKey },
    });

    const forwardedOptions = expect.objectContaining({ idempotencyKey });
    expect(productCreate).toHaveBeenCalledWith(expect.anything(), forwardedOptions);
    expect(productUpdate).toHaveBeenCalledWith(expect.anything(), forwardedOptions);
    expect(productActivate).toHaveBeenCalledWith('prod_fake', forwardedOptions);
    expect(productArchive).toHaveBeenCalledWith('prod_fake', forwardedOptions);
    expect(priceCreate).toHaveBeenCalledWith(expect.anything(), forwardedOptions);
    expect(priceActivate).toHaveBeenCalledWith('price_fake', forwardedOptions);
    expect(priceArchive).toHaveBeenCalledWith('price_fake', forwardedOptions);
  });

  it.each([
    ' ',
    'x'.repeat(256),
  ])('returns INVALID_IDEMPOTENCY_KEY before mutation for %j', async (idempotencyKey) => {
    const provider = new HttpCatalogProvider();
    const payable = createCatalogHttpPayable(provider, new TrackingCatalogIdempotencyStore());
    const client = await connect(payable);

    const invalid = await client.callTool({
      name: 'product_create',
      arguments: { name: 'Pro', idempotencyKey },
    });

    expect(invalid.isError).toBe(true);
    expect(parse(invalid)).toMatchObject({ error: 'INVALID_IDEMPOTENCY_KEY' });
    expect(provider.productCreateCalls).toBe(0);
  });

  it('returns idempotency conflicts through the MCP error envelope', async () => {
    const provider = new HttpCatalogProvider();
    const payable = createCatalogHttpPayable(provider, new TrackingCatalogIdempotencyStore());
    const client = await connect(payable);
    const idempotencyKey = 'conflicting-request';

    await client.callTool({
      name: 'product_create',
      arguments: { name: 'Pro', idempotencyKey },
    });
    const conflict = await client.callTool({
      name: 'product_create',
      arguments: { name: 'Enterprise', idempotencyKey },
    });

    expect(conflict.isError).toBe(true);
    expect(parse(conflict)).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.productCreateCalls).toBe(1);
  });

  it('returns in-progress operations through the MCP error envelope', async () => {
    const provider = new HttpCatalogProvider();
    const pendingProduct = provider.blockProductCreation();
    const store = new TrackingCatalogIdempotencyStore();
    const payable = createCatalogHttpPayable(provider, store);
    const client = await connect(payable);
    const idempotencyKey = 'in-progress-request';

    const first = payable
      .providerCatalog('stripe')
      .products.create({ name: 'Pro' }, { idempotencyKey });
    await pendingProduct.started;
    const inProgressRequest = client.callTool({
      name: 'product_create',
      arguments: { name: 'Pro', idempotencyKey },
    });
    await vi.waitFor(() => {
      expect(store.searchedKeys.length >= 2 || provider.productCreateCalls >= 2).toBe(true);
    });
    pendingProduct.release();
    const [inProgress] = await Promise.all([inProgressRequest, first]);

    expect(inProgress.isError).toBe(true);
    expect(parse(inProgress)).toMatchObject({ error: 'IDEMPOTENCY_IN_PROGRESS' });
    expect(provider.productCreateCalls).toBe(1);
  });
});
