import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import Fastify, { type FastifyRequest } from 'fastify';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { DEFAULT_BODY_LIMIT } from '../src/presentation/fastify/limits';
import { createPayableMcpServer } from '../src/presentation/mcp';
import type { PayableHttpRequest } from '../src/presentation/nest/payable.constants';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { createNestExpressApplication } from './support/nest-express-application';
import { migrationAdapterPayable } from './support/subscription-migration-adapter-payable';

const PATH = '/canonical/subscription-price-migrations';
const BODY = {
  subscriptionId: 'subscription-1',
  targetPriceId: 'price-new',
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
};
const authorization = (tenantId?: string) => ({
  allowed: true,
  actorId: 'migration-operator',
  actorType: 'service',
  tenantId,
});

describe('provider-neutral subscription migration adapter parity', () => {
  it('exposes equivalent create, list, retrieve, approve, cancel, and retry contracts', async () => {
    const adapters = await createAdapters();
    try {
      for (const adapter of adapters) {
        const results = [
          await adapter.create(BODY, 'create-key'),
          await adapter.list({ limit: 7, cursor: 'cursor-a' }),
          await adapter.retrieve('migration-1'),
          await adapter.mutate('approve', 'migration-1', 'approve-key'),
          await adapter.mutate('cancel', 'migration-1', 'cancel-key'),
          await adapter.mutate('retry', 'migration-1', 'retry-key'),
        ];
        expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200, 200]);
        expect(results[0]?.body.id).toBe('created-tenant-a-create-key');
        expect(results[1]?.body).toMatchObject({
          items: [{ id: 'listed-tenant-a-7-cursor-a' }],
          hasMore: true,
          nextCursor: 'next-cursor',
        });
        expect(results[3]?.body.id).toBe('approved-tenant-a-migration-1-approve-key');
        for (const result of results) {
          expect(JSON.stringify(result.body)).not.toMatch(
            /providerEvidence|providerSubscriptionId|private-provider|executionToken|requestHash/u,
          );
        }
      }
      const denied = await adapters[3]?.create(BODY, 'deny-key');
      expect(denied?.body).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
      const oversized = await adapters[0]?.create(
        { ...BODY, padding: 'x'.repeat(70 * 1_024) },
        'oversized-key',
      );
      expect(oversized).toMatchObject({ status: 413, body: { error: 'PAYLOAD_TOO_LARGE' } });
    } finally {
      await Promise.all(adapters.map((adapter) => adapter.close()));
    }
  });

  it('enforces strict timing, tenant, authorization, idempotency, and bounded pages over HTTP', async () => {
    const adapters = (await createAdapters()).slice(0, 3);
    try {
      for (const adapter of adapters) {
        expect((await adapter.create({ ...BODY, unknown: true }, 'strict-key')).status).toBe(422);
        expect(
          (
            await adapter.create(
              { ...BODY, effectiveTiming: 'scheduled', effectiveAt: undefined },
              'scheduled-key',
            )
          ).status,
        ).toBe(422);
        expect((await adapter.create(BODY)).status).toBe(400);
        expect((await adapter.create(BODY, 'key', { tenant: '' })).status).toBe(400);
        expect((await adapter.create(BODY, 'key', { allowed: false })).status).toBe(403);
        expect((await adapter.list({ limit: 101 })).status).toBe(422);
      }
    } finally {
      await Promise.all(adapters.map((adapter) => adapter.close()));
    }
  });

  it('applies bounded Fastify mutation limits and exposes no execution scheduler', async () => {
    const routes: Array<{ url: string; bodyLimit?: number; rateLimit?: unknown }> = [];
    const app = Fastify();
    app.addHook('onRoute', (route) => {
      if (route.method === 'POST' && route.url.startsWith(PATH)) {
        routes.push({
          url: route.url,
          bodyLimit: route.bodyLimit,
          rateLimit: (route.config as { rateLimit?: unknown } | undefined)?.rateLimit,
        });
      }
    });
    await app.register(
      createFastifyPayablePlugin(migrationAdapterPayable(), {
        rateLimit: { max: 2, timeWindow: '1 minute' },
        resolveTenant: () => 'tenant-a',
        resolveAuthorization: () => authorization('tenant-a'),
      }),
    );
    expect(routes.map((route) => route.url)).toEqual([
      PATH,
      `${PATH}/:id/approve`,
      `${PATH}/:id/cancel`,
      `${PATH}/:id/retry`,
    ]);
    expect(routes.every((route) => route.bodyLimit === DEFAULT_BODY_LIMIT)).toBe(true);
    expect(routes.every((route) => (route.rateLimit as { max: number }).max === 2)).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: `${PATH}/migration-1/execute` })).statusCode,
    ).toBe(404);
    await app.close();

    const server = createPayableMcpServer(migrationAdapterPayable(), {
      defaultTenantId: 'tenant-a',
      policy: { authorization: () => authorization('tenant-a') },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'migration-tool-list', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('canonical_subscription_price_migration_execute');
    expect(names).not.toContain('canonical_subscription_price_migrations_due');
    await client.close();
    await server.close();
  });
});

interface Result {
  status: number;
  body: Record<string, unknown>;
}

interface HttpResult {
  status?: number;
  statusCode?: number;
  body: Record<string, unknown>;
}

interface Adapter {
  create(
    body: Record<string, unknown>,
    key?: string,
    access?: { tenant?: string; allowed?: boolean },
  ): Promise<Result>;
  list(query: Record<string, unknown>): Promise<Result>;
  retrieve(id: string): Promise<Result>;
  mutate(action: 'approve' | 'cancel' | 'retry', id: string, key: string): Promise<Result>;
  close(): Promise<void>;
}

async function createAdapters(): Promise<Adapter[]> {
  const payable = migrationAdapterPayable();
  const expressApp = express();
  expressApp.use('/payable', createExpressPayableRoutes(payable, expressOptions()));
  const fastify = Fastify();
  await fastify.register(createFastifyPayablePlugin(payable, fastifyOptions()), {
    prefix: '/payable',
  });
  const nest = await createNestExpressApplication(PayableModule.forRoot(payable, nestOptions()));
  const server = createPayableMcpServer(payable, {
    defaultTenantId: 'tenant-a',
    policy: {
      authorization: (_name, args) => ({
        ...authorization('tenant-a'),
        allowed: args.idempotencyKey !== 'deny-key',
      }),
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'migration-adapters', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return [
    httpAdapter((method, path, body, headers) => {
      const call = request(expressApp)[method](`/payable${path}`).set(headers);
      return method === 'get' ? call.query(body) : call.send(body);
    }),
    httpAdapter(
      async (method, path, body, headers) => {
        const query = new URLSearchParams(
          Object.entries(body).map(([key, value]) => [key, String(value)] as [string, string]),
        );
        const result = await fastify.inject(
          method === 'get'
            ? { method: 'GET', url: `/payable${path}?${query}`, headers }
            : { method: 'POST', url: `/payable${path}`, headers, payload: body },
        );
        return { status: result.statusCode, body: result.json() };
      },
      async () => fastify.close(),
    ),
    httpAdapter(
      (method, path, body, headers) => {
        const call = request(nest.getHttpServer())[method](path).set(headers);
        return method === 'get' ? call.query(body) : call.send(body);
      },
      async () => nest.close(),
    ),
    mcpAdapter(client, async () => {
      await client.close();
      await server.close();
    }),
  ];
}

function httpAdapter(
  send: (
    method: 'get' | 'post',
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => Promise<HttpResult>,
  close = async () => {},
): Adapter {
  const call = async (
    method: 'get' | 'post',
    path: string,
    body: Record<string, unknown>,
    key?: string,
    access: { tenant?: string; allowed?: boolean } = {},
  ): Promise<Result> => {
    const headers: Record<string, string> = {
      'x-tenant': access.tenant ?? 'tenant-a',
      'x-allowed': String(access.allowed ?? true),
    };
    if (key) headers['idempotency-key'] = key;
    const result = await send(method, path, body, headers);
    return { status: result.status ?? result.statusCode ?? 500, body: result.body };
  };
  return {
    create: (body, key, access) => call('post', PATH, body, key, access),
    list: (query) => call('get', PATH, query),
    retrieve: (id) => call('get', `${PATH}/${id}`, {}),
    mutate: (action, id, key) => call('post', `${PATH}/${id}/${action}`, {}, key),
    close,
  };
}

function mcpAdapter(client: Client, close: () => Promise<void>): Adapter {
  const invoke = async (name: string, args: Record<string, unknown>): Promise<Result> => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const block = result.content[0];
    return {
      status: result.isError ? 400 : 200,
      body: block?.type === 'text' ? (JSON.parse(block.text) as Record<string, unknown>) : {},
    };
  };
  return {
    create: (body, key) =>
      invoke('canonical_subscription_price_migration_create', { ...body, idempotencyKey: key }),
    list: (query) => invoke('canonical_subscription_price_migrations_list', { ...query }),
    retrieve: (id) => invoke('canonical_subscription_price_migration_get', { id }),
    mutate: (action, id, key) =>
      invoke(`canonical_subscription_price_migration_${action}`, { id, idempotencyKey: key }),
    close,
  };
}

function expressOptions() {
  return {
    resolveTenant: (req: express.Request) => String(req.headers['x-tenant'] ?? ''),
    resolveAuthorization: (req: express.Request) =>
      authorization(String(req.headers['x-tenant'] ?? '')) && {
        ...authorization(String(req.headers['x-tenant'] ?? '')),
        allowed: req.headers['x-allowed'] === 'true',
      },
  };
}

function fastifyOptions() {
  return {
    resolveTenant: (req: FastifyRequest) => String(req.headers['x-tenant'] ?? ''),
    resolveAuthorization: (req: FastifyRequest) => ({
      ...authorization(String(req.headers['x-tenant'] ?? '')),
      allowed: req.headers['x-allowed'] === 'true',
    }),
  };
}

function nestOptions() {
  return {
    resolveTenant: (req: PayableHttpRequest) => String(req.headers['x-tenant'] ?? ''),
    resolveAuthorization: (req: PayableHttpRequest) => ({
      ...authorization(String(req.headers['x-tenant'] ?? '')),
      allowed: req.headers['x-allowed'] === 'true',
    }),
  };
}
