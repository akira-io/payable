import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import { FakeProvider } from './support/fake-provider';

async function connect() {
  const stripe = new FakeProvider();
  const paddle = new FakeProvider();
  const server = createPayableMcpServer(
    createPayable({ providers: { stripe, paddle }, tenant: { enabled: true } }),
    {
      defaultTenantId: 'tenant-a',
      policy: {
        authorization: () => ({ allowed: true, actorId: 'catalog-operator' }),
      },
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'catalog-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, paddle };
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
        active: false,
        providerProductId: 'prod_fake',
      },
    })) as CallToolResult;
    expect(parse(prices)).toMatchObject({ data: [{ providerPriceId: 'price_fake' }] });
    expect(paddle.lastListPrices).toEqual({
      limit: 30,
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
});
