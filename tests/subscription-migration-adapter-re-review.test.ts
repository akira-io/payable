import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import Fastify from 'fastify';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { createPayableMcpServer } from '../src/presentation/mcp';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { createNestExpressApplication } from './support/nest-express-application';
import { migrationAdapterPayable } from './support/subscription-migration-adapter-payable';

const BASE = '/canonical/subscription-price-migrations';
const body = {
  subscriptionId: 'subscription-1',
  targetPriceId: 'price-new',
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
};
const options = {
  resolveTenant: () => 'tenant-a',
  resolveAuthorization: () => ({ allowed: true, actorId: 'operator', tenantId: 'tenant-a' }),
};

describe('subscription migration adapter re-review contracts', () => {
  it('rejects a chunked Nest request by raw bytes even when parsed JSON is small', async () => {
    const app = await createNestExpressApplication(
      PayableModule.forRoot(migrationAdapterPayable(), options),
    );
    try {
      const response = await sendChunkedJson(
        app,
        `${' '.repeat(70 * 1_024)}${JSON.stringify(body)}`,
      );
      expect(response).toEqual({
        status: 413,
        body: {
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the configured size limit',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('fails closed when the mandatory Nest raw-body boundary was not installed', async () => {
    const app = await createNestExpressApplication(
      PayableModule.forRoot(migrationAdapterPayable(), options),
      { installPayableBodyParser: false },
    );
    try {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .set('Idempotency-Key', 'missing-parser')
        .send(body);
      expect(response).toMatchObject({
        status: 500,
        body: { error: 'NEST_SUBSCRIPTION_MIGRATION_BODY_PARSER_REQUIRED' },
      });
    } finally {
      await app.close();
    }
  });

  it('preserves reconciliation-critical persistence failures with safe details', async () => {
    const app = express();
    app.use('/payable', createExpressPayableRoutes(migrationAdapterPayable(), options));
    const response = await request(app)
      .post(`/payable${BASE}/persistence-error/approve`)
      .set('Idempotency-Key', 'persistence-key')
      .send({});
    expect(response).toMatchObject({
      status: 500,
      body: {
        error: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
        message: 'Subscription migration result persistence failed',
        correlationId: 'corr-migration-persistence',
        guidance:
          'Reconcile the provider result and durable local state before retrying with a new idempotency key.',
      },
    });
  });

  it('rejects unknown keys for every non-create MCP migration tool', async () => {
    const { client, close } = await mcpClient();
    try {
      for (const [name, arguments_] of [
        ['canonical_subscription_price_migrations_list', { unknown: true }],
        ['canonical_subscription_price_migration_get', { id: 'migration-1', unknown: true }],
        [
          'canonical_subscription_price_migration_approve',
          { id: 'migration-1', idempotencyKey: 'approve-key', unknown: true },
        ],
        [
          'canonical_subscription_price_migration_cancel',
          { id: 'migration-1', idempotencyKey: 'cancel-key', unknown: true },
        ],
        [
          'canonical_subscription_price_migration_retry',
          { id: 'migration-1', idempotencyKey: 'retry-key', unknown: true },
        ],
      ] as const) {
        const result = (await client.callTool({ name, arguments: arguments_ })) as CallToolResult;
        expect(result.isError).toBe(true);
        expect(result.content[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining('Input validation error'),
        });
      }
    } finally {
      await close();
    }
  });

  it('maps Fastify body and rate framework errors to canonical envelopes', async () => {
    const oversized = await fastifyApp({ max: 100, timeWindow: '1 minute' });
    const limited = await fastifyApp({ max: 1, timeWindow: '1 minute' });
    try {
      const tooLarge = await oversized.inject({
        method: 'POST',
        url: BASE,
        headers: { 'idempotency-key': 'oversized' },
        payload: { ...body, padding: 'x'.repeat(70 * 1_024) },
      });
      expect({ status: tooLarge.statusCode, body: tooLarge.json() }).toEqual({
        status: 413,
        body: {
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the configured size limit',
        },
      });

      const first = await limited.inject({
        method: 'POST',
        url: BASE,
        headers: { 'idempotency-key': 'rate-one' },
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      const rateLimited = await limited.inject({
        method: 'POST',
        url: BASE,
        headers: { 'idempotency-key': 'rate-two' },
        payload: body,
      });
      expect({ status: rateLimited.statusCode, body: rateLimited.json() }).toEqual({
        status: 429,
        body: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many mutation requests' },
      });
    } finally {
      await Promise.all([oversized.close(), limited.close()]);
    }
  });
});

async function mcpClient() {
  const server = createPayableMcpServer(migrationAdapterPayable(), {
    defaultTenantId: 'tenant-a',
    policy: { authorization: () => options.resolveAuthorization() },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'migration-re-review', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => Promise.all([client.close(), server.close()]) };
}

async function fastifyApp(rateLimit: { max: number; timeWindow: string }) {
  const app = Fastify();
  await app.register(
    createFastifyPayablePlugin(migrationAdapterPayable(), { ...options, rateLimit }),
  );
  return app;
}

async function sendChunkedJson(
  app: Awaited<ReturnType<typeof createNestExpressApplication>>,
  raw: string,
) {
  const server = app.getHttpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const call = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: BASE,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'chunked-body',
          'transfer-encoding': 'chunked',
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) }),
        );
      },
    );
    call.on('error', reject);
    call.write(raw.slice(0, 32 * 1_024));
    call.end(raw.slice(32 * 1_024));
  });
}
