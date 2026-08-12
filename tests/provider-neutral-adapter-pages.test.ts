import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import Fastify from 'fastify';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { createPayableMcpServer } from '../src/presentation/mcp';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createNestExpressApplication } from './support/nest-express-application';

const TENANT = 'tenant-adapters';
const STARTS_AT = new Date('2026-08-08T12:00:00.000Z');

interface Fixture {
  payable: Payable;
  ids: Record<'customer' | 'product' | 'price' | 'subscription' | 'payment' | 'invoice', string>;
}

describe('provider-neutral collection adapter parity', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('serves the same canonical pages and exact reads through Express', async () => {
    const fixture = await createFixture(databases);
    const app = express();
    app.use(
      '/payable',
      createExpressPayableRoutes(fixture.payable, { resolveTenant: () => TENANT }),
    );

    for (const [resource, id] of Object.entries(fixture.ids)) {
      const collection = resource === 'payment' ? 'payments' : `${resource}s`;
      const page = await request(app).get(`/payable/canonical/${collection}`).query({ limit: 1 });
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ hasMore: false, nextCursor: null });
      expect(page.body.items).toHaveLength(1);

      const exact = await request(app).get(`/payable/canonical/${collection}/${id}`);
      expect(exact.status).toBe(200);
      expect(exact.body.id).toBe(id);
    }

    const malformed = await request(app)
      .get('/payable/canonical/products')
      .query({ cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('COLLECTION_CURSOR_INVALID');
  });

  it('serves the same canonical pages and exact reads through Fastify', async () => {
    const fixture = await createFixture(databases);
    const app = Fastify();
    await app.register(
      createFastifyPayablePlugin(fixture.payable, { resolveTenant: () => TENANT }),
      { prefix: '/payable' },
    );
    await app.ready();

    try {
      for (const [resource, id] of Object.entries(fixture.ids)) {
        const collection = resource === 'payment' ? 'payments' : `${resource}s`;
        const page = await app.inject({
          method: 'GET',
          url: `/payable/canonical/${collection}?limit=1`,
        });
        expect(page.statusCode).toBe(200);
        expect(page.json()).toMatchObject({ hasMore: false, nextCursor: null });
        expect(page.json().items).toHaveLength(1);

        const exact = await app.inject({
          method: 'GET',
          url: `/payable/canonical/${collection}/${id}`,
        });
        expect(exact.statusCode).toBe(200);
        expect(exact.json().id).toBe(id);
      }
    } finally {
      await app.close();
    }
  });

  it('serves the same canonical pages and exact reads through Nest', async () => {
    const fixture = await createFixture(databases);
    const app = await createNestExpressApplication(
      PayableModule.forRoot(fixture.payable, { resolveTenant: () => TENANT }),
    );

    try {
      for (const [resource, id] of Object.entries(fixture.ids)) {
        const collection = resource === 'payment' ? 'payments' : `${resource}s`;
        const page = await request(app.getHttpServer())
          .get(`/canonical/${collection}`)
          .query({ limit: 1 });
        expect(page.status).toBe(200);
        expect(page.body).toMatchObject({ hasMore: false, nextCursor: null });
        expect(page.body.items).toHaveLength(1);

        const exact = await request(app.getHttpServer()).get(`/canonical/${collection}/${id}`);
        expect(exact.status).toBe(200);
        expect(exact.body.id).toBe(id);
      }
    } finally {
      await app.close();
    }
  });

  it('serves the same canonical pages and exact reads through MCP', async () => {
    const fixture = await createFixture(databases);
    const server = createPayableMcpServer(fixture.payable, { defaultTenantId: TENANT });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'canonical-page-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      for (const [resource, id] of Object.entries(fixture.ids)) {
        const collection = resource === 'payment' ? 'payments' : `${resource}s`;
        const page = (await client.callTool({
          name: `canonical_${collection}_list`,
          arguments: { limit: 1 },
        })) as CallToolResult;
        expect(parseToolResult(page)).toMatchObject({
          items: [{ id }],
          hasMore: false,
          nextCursor: null,
        });

        const exact = (await client.callTool({
          name: `canonical_${resource}_get`,
          arguments: { id },
        })) as CallToolResult;
        expect(parseToolResult(exact)).toMatchObject({ id });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function createFixture(databases: ReturnType<typeof createTestDb>[]): Promise<Fixture> {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const storage = new KnexStorageDriver(database, new FakeClock(STARTS_AT));
  const payable = createPayable({ storage, tenant: { enabled: true } });
  const customer = await payable.customers(undefined, TENANT).create({
    billableType: 'User',
    billableId: 'canonical-adapter-user',
    email: 'canonical-adapter@example.com',
    name: 'Canonical Adapter',
  });
  const product = await payable.products(TENANT).create({ name: 'Canonical adapter product' });
  const price = await payable.prices(TENANT).create({
    productId: product.id,
    unitAmount: Money.of(1900, 'EUR'),
    type: 'recurring',
    interval: 'month',
  });
  const subscription = await payable.canonicalSubscriptions(TENANT).create({
    customerId: customer.id,
    name: 'canonical-adapter-subscription',
    priceId: price.id,
    activation: { state: 'active', startsAt: STARTS_AT },
    collectionResponsibility: 'merchant',
    source: 'adapter-test',
  });
  const payment = await storage.payments.create({
    tenantId: TENANT,
    customerId: customer.id,
    provider: 'manual',
    providerPaymentId: null,
    status: 'pending',
    currency: 'EUR',
    amount: 1900,
    refundedAmount: 0,
    reference: 'adapter-transfer',
    description: 'Provider-neutral adapter payment',
  });
  const invoice = await payable.canonicalInvoices(TENANT).create({
    customerId: customer.id,
    subscriptionId: subscription.id,
    status: 'open',
    currency: 'EUR',
    total: 1900,
    amountPaid: 0,
    amountDue: 1900,
    number: 'INV-ADAPTER',
  });

  return {
    payable,
    ids: {
      customer: customer.id,
      product: product.id,
      price: price.id,
      subscription: subscription.id,
      payment: payment.id,
      invoice: invoice.id,
    },
  };
}

function parseToolResult(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('Expected a text result');
  }
  return JSON.parse(block.text);
}
