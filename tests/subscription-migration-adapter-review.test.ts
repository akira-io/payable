import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayableMcpServer } from '../src/presentation/mcp';
import { migrationAdapterPayable } from './support/subscription-migration-adapter-payable';

const clients: Client[] = [];
const servers: ReturnType<typeof createPayableMcpServer>[] = [];
const createInput = {
  subscriptionId: 'subscription-1',
  targetPriceId: 'price-new',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
  idempotencyKey: 'mcp-review-create',
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('subscription migration adapter review contracts', () => {
  it.each([
    { ...createInput, effectiveTiming: 'scheduled' },
    { ...createInput, effectiveTiming: 'immediate', effectiveAt: '2026-09-01T10:00:00Z' },
    { ...createInput, effectiveTiming: 'immediate', unknown: true },
  ])('rejects an invalid strict MCP preview before the resource runs', async (arguments_) => {
    const client = await mcpClient();

    const result = (await client.callTool({
      name: 'canonical_subscription_price_migration_create',
      arguments: arguments_,
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Input validation error'),
    });
  });

  it('uses the exact scheduled timing union and exposes canonical preview timestamps', async () => {
    const client = await mcpClient();
    const effectiveAt = '2026-09-01T10:00:00.000Z';

    const result = await call(client, 'canonical_subscription_price_migration_create', {
      ...createInput,
      effectiveTiming: 'scheduled',
      effectiveAt,
    });

    expect(result).toMatchObject({
      effectiveTiming: 'scheduled',
      effectiveAt,
      calculatedAt: '2026-08-25T12:00:00.000Z',
      expiresAt: '2026-08-25T12:15:00.000Z',
    });
  });

  it('deeply allow-lists migration pages and persisted failed resources', async () => {
    const client = await mcpClient();
    const page = await call(client, 'canonical_subscription_price_migrations_list', { limit: 1 });
    const failed = await call(client, 'canonical_subscription_price_migration_get', {
      id: 'failed',
    });

    for (const result of [page, failed]) {
      expect(JSON.stringify(result)).not.toMatch(
        /secret|failureCode|failureMessage|providerEvidence|executionToken|requestHash/u,
      );
    }
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          calculatedAt: expect.any(String),
          expiresAt: expect.any(String),
        }),
      ],
      hasMore: true,
      nextCursor: 'next-cursor',
    });
  });

  it('replaces an arbitrary action error code and message with a safe canonical envelope', async () => {
    const client = await mcpClient();

    const result = (await client.callTool({
      name: 'canonical_subscription_price_migration_approve',
      arguments: { id: 'unsafe-error', idempotencyKey: 'unsafe-error-key' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({
      error: 'SUBSCRIPTION_MIGRATION_OPERATION_FAILED',
      message: 'Subscription migration operation failed',
    });
  });

  it('preserves the sanitized provider-not-applied code and canonical message', async () => {
    const client = await mcpClient();

    const result = (await client.callTool({
      name: 'canonical_subscription_price_migration_approve',
      arguments: { id: 'provider-not-applied', idempotencyKey: 'provider-not-applied-key' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({
      error: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      message: 'Provider did not apply the subscription migration',
    });
  });

  it('preserves safe mutation-claim recovery metadata in MCP errors', async () => {
    const client = await mcpClient();

    const result = (await client.callTool({
      name: 'canonical_subscription_price_migration_approve',
      arguments: { id: 'mutation-claim-recovery', idempotencyKey: 'mutation-claim-recovery-key' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({
      error: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      message: 'Subscription mutation requires reconciliation',
      correlationId: 'correlation-safe-mcp',
      claimReference: 'claim-safe-mcp',
      guidance:
        'Resolve the retained subscription mutation claim before attempting another provider mutation.',
    });
  });
});

async function mcpClient(): Promise<Client> {
  const server = createPayableMcpServer(migrationAdapterPayable(), {
    defaultTenantId: 'tenant-a',
    policy: {
      authorization: () => ({ allowed: true, actorId: 'reviewer', tenantId: 'tenant-a' }),
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'migration-review', version: '0' });
  servers.push(server);
  clients.push(client);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(client: Client, name: string, arguments_: Record<string, unknown>) {
  return parse((await client.callTool({ name, arguments: arguments_ })) as CallToolResult);
}

function parse(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('Expected text tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}
