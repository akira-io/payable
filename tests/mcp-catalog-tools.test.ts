import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { createPayable } from '../src/create-payable';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import type { McpPayableOptions } from '../src/presentation/mcp/options';
import { FakeProvider } from './support/fake-provider';

async function connect(
  options: McpPayableOptions = { defaultTenantId: 'tenant-a' },
  authorizationEnabled = false,
) {
  const stripe = new FakeProvider();
  const paddle = new FakeProvider();
  const payable = createPayable({
    providers: { stripe, paddle },
    tenant: { enabled: true },
    authorization: { enabled: authorizationEnabled },
  });
  const server = createPayableMcpServer(payable, {
    ...options,
    policy: {
      ...options.policy,
      authorization: () => ({ allowed: true, actorId: 'catalog-operator' }),
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'catalog-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, paddle, payable };
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('expected text result');
  }
  return JSON.parse(block.text);
}

describe('mcp catalog tools', () => {
  it('reads catalog resources and preserves price product filtering', async () => {
    const { client, paddle } = await connect();
    const products = (await client.callTool({
      name: 'products_list',
      arguments: { provider: 'paddle', limit: 25, cursor: 'products-cursor', active: false },
    })) as CallToolResult;
    expect(parse(products)).toMatchObject({ data: [{ providerProductId: 'prod_fake' }] });
    expect(paddle.lastListProducts).toEqual({
      limit: 25,
      cursor: 'products-cursor',
      active: false,
    });

    const product = (await client.callTool({
      name: 'product_get',
      arguments: { provider: 'paddle', id: 'prod_fake' },
    })) as CallToolResult;
    expect(parse(product)).toMatchObject({ providerProductId: 'prod_fake' });

    const prices = (await client.callTool({
      name: 'prices_list',
      arguments: {
        provider: 'paddle',
        limit: 30,
        cursor: 'prices-cursor',
        active: false,
        providerProductId: 'prod_fake',
      },
    })) as CallToolResult;
    expect(parse(prices)).toMatchObject({ data: [{ providerPriceId: 'price_fake' }] });
    expect(paddle.lastListPrices).toEqual({
      limit: 30,
      cursor: 'prices-cursor',
      active: false,
      providerProductId: 'prod_fake',
    });

    const price = (await client.callTool({
      name: 'price_get',
      arguments: { provider: 'paddle', id: 'price_fake' },
    })) as CallToolResult;
    expect(parse(price)).toMatchObject({ providerPriceId: 'price_fake' });
  });

  it('runs catalog lifecycle operations and rejects invalid list limits', async () => {
    const { client, paddle } = await connect();
    for (const name of ['product_activate', 'product_archive', 'price_activate', 'price_archive']) {
      const id = name.startsWith('product') ? 'prod_fake' : 'price_fake';
      const result = (await client.callTool({
        name,
        arguments: { provider: 'paddle', id },
      })) as CallToolResult;
      expect(result.isError).toBeUndefined();
    }
    expect(paddle.productActiveCalls.map(({ active }) => active)).toEqual([true, false]);
    expect(paddle.priceActiveCalls.map(({ active }) => active)).toEqual([true, false]);

    for (const limit of [0, 1.5, 101]) {
      const invalid = (await client.callTool({
        name: 'products_list',
        arguments: { limit },
      })) as CallToolResult;
      expect(invalid.isError).toBe(true);
    }
  });

  it('passes the authorized MCP context to lifecycle resources', async () => {
    const { client, paddle } = await connect({ defaultTenantId: 'tenant-a' }, true);

    const result = (await client.callTool({
      name: 'product_archive',
      arguments: { provider: 'paddle', id: 'prod_fake' },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    expect(paddle.productActiveCalls).toMatchObject([{ id: 'prod_fake', active: false }]);
  });

  it('accepts and forwards both list limit boundaries', async () => {
    const { client, paddle } = await connect();

    for (const limit of [1, 100]) {
      const products = (await client.callTool({
        name: 'products_list',
        arguments: { provider: 'paddle', limit },
      })) as CallToolResult;
      expect(products.isError).toBeUndefined();
      expect(paddle.lastListProducts?.limit).toBe(limit);

      const prices = (await client.callTool({
        name: 'prices_list',
        arguments: { provider: 'paddle', limit },
      })) as CallToolResult;
      expect(prices.isError).toBeUndefined();
      expect(paddle.lastListPrices?.limit).toBe(limit);
    }
  });

  it.each([
    {
      name: 'uses a pinned default when override is disabled',
      options: { defaultTenantId: 'tenant-a' },
      tenantId: 'tenant-b',
      expectedTenantId: 'tenant-a',
    },
    {
      name: 'uses the client tenant when override is enabled',
      options: { defaultTenantId: 'tenant-a', allowTenantOverride: true },
      tenantId: 'tenant-b',
      expectedTenantId: 'tenant-b',
    },
    {
      name: 'ignores the client tenant without a pinned default',
      options: {},
      tenantId: 'tenant-b',
      expectedTenantId: undefined,
    },
    {
      name: 'uses the client tenant without a default when override is enabled',
      options: { allowTenantOverride: true },
      tenantId: 'tenant-c',
      expectedTenantId: 'tenant-c',
    },
    {
      name: 'uses the pinned default when the client omits a tenant',
      options: { defaultTenantId: 'tenant-a', allowTenantOverride: true },
      tenantId: undefined,
      expectedTenantId: 'tenant-a',
    },
  ])('$name through catalog tools', async ({ options, tenantId, expectedTenantId }) => {
    const { client, payable } = await connect(options);
    const productsResource = vi.spyOn(payable, 'products');
    const pricesResource = vi.spyOn(payable, 'prices');
    const tenantArgument = tenantId === undefined ? {} : { tenantId };

    const product = (await client.callTool({
      name: 'product_get',
      arguments: { provider: 'paddle', id: 'prod_fake', ...tenantArgument },
    })) as CallToolResult;
    const price = (await client.callTool({
      name: 'price_get',
      arguments: { provider: 'paddle', id: 'price_fake', ...tenantArgument },
    })) as CallToolResult;

    expect(productsResource).toHaveBeenCalledWith('paddle', expectedTenantId);
    expect(pricesResource).toHaveBeenCalledWith('paddle', expectedTenantId);
    if (expectedTenantId === undefined) {
      expect(parse(product)).toMatchObject({ error: 'TENANT_REQUIRED' });
      expect(parse(price)).toMatchObject({ error: 'TENANT_REQUIRED' });
      return;
    }
    expect(product.isError).toBeUndefined();
    expect(price.isError).toBeUndefined();
  });
});
