import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { ProductResource } from '../src/application/builders/product-resource';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const calls = [
  { name: 'product_create', arguments: { name: 'Pro' } },
  {
    name: 'product_update',
    arguments: { providerProductId: 'prod_fake', name: 'Pro v2' },
  },
  { name: 'product_activate', arguments: { id: 'prod_fake' } },
  { name: 'product_archive', arguments: { id: 'prod_fake' } },
  {
    name: 'price_create',
    arguments: { providerProductId: 'prod_fake', unitAmount: { amount: 9900, currency: 'USD' } },
  },
  { name: 'price_activate', arguments: { id: 'price_fake' } },
  { name: 'price_archive', arguments: { id: 'price_fake' } },
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
  const context = {
    allowed,
    actorId: 'catalog-agent',
    actorType: 'service',
    tenantId: 'tenant-a',
  };
  const authorization = vi.fn(() => context);
  const payable = createPayable({
    providers: { stripe: provider },
    storage: new KnexStorageDriver(db, new FakeClock()),
    tenant: { enabled: true },
    authorization: { enabled: true },
  });
  const server = createPayableMcpServer(payable, {
    defaultTenantId: 'tenant-a',
    policy: { authorization },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-catalog-authorization', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { authorization, client, context, db, provider };
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('expected text result');
  }
  return JSON.parse(block.text);
}

describe('mcp catalog authorization', () => {
  it.each(calls)('denies $name before provider or storage mutation', async (call) => {
    const { authorization, client, db, provider } = await setup(false);

    try {
      const result = (await client.callTool(call)) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(parse(result)).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      expect(authorization).toHaveBeenCalledOnce();
      expect(authorization).toHaveBeenCalledWith(call.name, call.arguments);
      expect(providerMutationCount(provider)).toBe(0);
      await expectStorageUntouched(db);
    } finally {
      await db.destroy();
    }
  });

  it.each(calls)('allows $name with one provider mutation', async (call) => {
    const { authorization, client, db, provider } = await setup(true);

    try {
      const result = (await client.callTool(call)) as CallToolResult;

      expect(result.isError).toBeUndefined();
      expect(authorization).toHaveBeenCalledOnce();
      expect(authorization).toHaveBeenCalledWith(call.name, call.arguments);
      expect(providerMutationCount(provider)).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('defers denied product-create authorization to the core resource', async () => {
    const { client, context, db } = await setup(false);
    const create = vi.spyOn(ProductResource.prototype, 'create');

    try {
      const result = (await client.callTool(calls[0])) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(parse(result)).toMatchObject({
        error: 'AUTHORIZATION_DENIED',
        message: 'Not authorized to create product',
      });
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]?.[1]?.authorization).toBe(context);
      await expect(create.mock.results[0]?.value).rejects.toMatchObject({
        code: 'AUTHORIZATION_DENIED',
        message: 'Not authorized to create product',
        context: { action: 'product.create' },
      });
    } finally {
      create.mockRestore();
      await db.destroy();
    }
  });

  it('forwards the product-create authorization object by identity', async () => {
    const { client, context, db } = await setup(true);
    const create = vi.spyOn(ProductResource.prototype, 'create');

    try {
      const result = (await client.callTool(calls[0])) as CallToolResult;

      expect(result.isError).toBeUndefined();
      expect(create.mock.calls[0]?.[1]?.authorization).toBe(context);
    } finally {
      create.mockRestore();
      await db.destroy();
    }
  });
});
