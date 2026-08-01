import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import type { McpPayableOptions } from '../src/presentation/mcp/options';
import { FakeProvider } from './support/fake-provider';

async function toolNames(options?: McpPayableOptions): Promise<string[]> {
  const payable = createPayable({ providers: { stripe: new FakeProvider() } });
  const server = createPayableMcpServer(payable, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  return listed.tools.map((tool) => tool.name);
}

describe('mcp policy gating', () => {
  it('hides money tools by default', async () => {
    const names = await toolNames();
    expect(names).toContain('subscriptions_list');
    expect(names).toContain('subscription_create');
    expect(names).not.toContain('charge');
    expect(names).not.toContain('refund');
  });

  it('exposes money tools when allowed', async () => {
    const names = await toolNames({ policy: { allowMoneyMovement: true } });
    expect(names).toContain('charge');
    expect(names).toContain('refund');
  });

  it('hides all mutations in read-only mode even with money allowed', async () => {
    const names = await toolNames({ policy: { readOnly: true, allowMoneyMovement: true } });
    expect(names).toContain('subscriptions_list');
    expect(names).not.toContain('charge');
    expect(names).not.toContain('subscription_create');
    expect(names).not.toContain('webhook_replay');
  });

  it('registers catalog reads and hides catalog lifecycle tools in read-only mode', async () => {
    const names = await toolNames({ policy: { readOnly: true } });

    expect(names).toEqual(
      expect.arrayContaining(['product_get', 'products_list', 'price_get', 'prices_list']),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        'product_activate',
        'product_archive',
        'price_activate',
        'price_archive',
      ]),
    );
  });

  it('registers only the supported catalog lifecycle tools', async () => {
    const names = await toolNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'product_get',
        'products_list',
        'price_get',
        'prices_list',
        'product_activate',
        'product_archive',
        'price_activate',
        'price_archive',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(['product_delete', 'price_delete', 'price_update']),
    );
  });

  it('restricts to an explicit allow-list', async () => {
    const names = await toolNames({ policy: { enabledTools: ['providers_list'] } });
    expect(names).toEqual(['providers_list']);
  });

  it('hides mutate and money tools when authorization is required but no callback is set', async () => {
    const names = await toolNames({
      policy: { allowMoneyMovement: true, requireAuthorization: true },
    });
    expect(names).toContain('subscriptions_list');
    expect(names).not.toContain('charge');
    expect(names).not.toContain('subscription_create');
    expect(names).not.toContain('webhook_replay');
  });

  it('exposes mutate and money tools when authorization is required and a callback is set', async () => {
    const names = await toolNames({
      policy: {
        allowMoneyMovement: true,
        requireAuthorization: true,
        authorization: () => ({ allowed: true, actorId: 'svc' }),
      },
    });
    expect(names).toContain('charge');
    expect(names).toContain('subscription_create');
  });
});
