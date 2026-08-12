import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import Fastify from 'fastify';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { createPayableMcpServer } from '../src/presentation/mcp';
import { PayableCanonicalReadController } from '../src/presentation/nest/payable-canonical-read.controller';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('confirmed provider-backed local refund adapters', () => {
  it('records through Fastify and rejects requests without explicit confirmation', async () => {
    const { payable, paymentId, provider } = await harness();
    const app = Fastify();
    await app.register(createFastifyPayablePlugin(payable), { prefix: '/payable' });
    const request = {
      method: 'POST' as const,
      url: `/payable/canonical/payments/${paymentId}/refunds/local`,
      headers: { 'idempotency-key': 'external-return-http-1' },
      payload: {
        amount: 400,
        currency: 'EUR',
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-http-400',
      },
    };

    const missingConfirmation = await app.inject(request);
    const confirmed = await app.inject({
      ...request,
      headers: { 'idempotency-key': 'external-return-http-2' },
      payload: { ...request.payload, confirmedExternally: true },
    });

    expect(missingConfirmation.statusCode).toBe(422);
    expect(missingConfirmation.json()).toMatchObject({
      error: 'LOCAL_REFUND_EXTERNAL_CONFIRMATION_REQUIRED',
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      paymentId,
      provider: null,
      externalReference: 'bank-return-http-400',
    });
    expect(provider.refundCalls).toBe(0);
    await app.close();
  });

  it('records through MCP without invoking the configured provider', async () => {
    const { payable, paymentId, provider } = await harness();
    const server = createPayableMcpServer(payable, {
      policy: { allowMoneyMovement: true },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mixed-refund-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = (await client.callTool({
      name: 'canonical_payment_refund_local',
      arguments: {
        paymentId,
        amount: { amount: 400, currency: 'EUR' },
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-mcp-400',
        confirmedExternally: true,
        idempotencyKey: 'external-return-mcp-1',
      },
    })) as CallToolResult;

    expect(parse(result)).toMatchObject({
      paymentId,
      provider: null,
      externalReference: 'bank-return-mcp-400',
    });
    expect(provider.refundCalls).toBe(0);
    await client.close();
    await server.close();
  });

  it('forwards confirmation through Express and rejects a missing external reference', async () => {
    const { payable, paymentId, provider } = await harness();
    const app = express();
    app.use('/payable', createExpressPayableRoutes(payable));

    const missingReference = await request(app)
      .post(`/payable/canonical/payments/${paymentId}/refunds/local`)
      .set('Idempotency-Key', 'external-return-express-1')
      .send({
        amount: 400,
        currency: 'EUR',
        collectionMethod: 'bank_transfer',
        confirmedExternally: true,
      });
    const confirmed = await request(app)
      .post(`/payable/canonical/payments/${paymentId}/refunds/local`)
      .set('Idempotency-Key', 'external-return-express-2')
      .send({
        amount: 400,
        currency: 'EUR',
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-express-400',
        confirmedExternally: true,
      });

    expect(missingReference.status).toBe(422);
    expect(missingReference.body).toMatchObject({
      error: 'LOCAL_REFUND_EXTERNAL_REFERENCE_REQUIRED',
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ provider: null, paymentId });
    expect(provider.refundCalls).toBe(0);
  });

  it('forwards confirmation through Nest and rejects an unconfirmed request', async () => {
    const { payable, paymentId, provider } = await harness();
    const controller = new PayableCanonicalReadController(payable, {});
    const requestContext = { headers: { 'idempotency-key': 'external-return-nest-1' } };
    const body = {
      amount: 400,
      currency: 'EUR',
      collectionMethod: 'bank_transfer',
      externalReference: 'bank-return-nest-400',
    };

    await expect(controller.recordRefund(requestContext, paymentId, body)).rejects.toMatchObject({
      code: 'LOCAL_REFUND_EXTERNAL_CONFIRMATION_REQUIRED',
    });
    await expect(
      controller.recordRefund(
        { headers: { 'idempotency-key': 'external-return-nest-2' } },
        paymentId,
        { ...body, confirmedExternally: true },
      ),
    ).resolves.toMatchObject({ provider: null, paymentId });
    expect(provider.refundCalls).toBe(0);
  });
});

async function harness() {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(database, clock);
  const provider = new FakeProvider();
  const payable = createPayable({
    providers: { stripe: provider },
    storage,
    clock,
    idempotency: { store: new KnexIdempotencyRepository(database, clock) },
  });
  const payment = await storage.payments.create({
    tenantId: null,
    customerId: null,
    provider: 'stripe',
    providerPaymentId: 'pi_adapter_provider_backed',
    status: 'succeeded',
    currency: 'EUR',
    amount: 1000,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
  return { payable, paymentId: payment.id, provider };
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0];
  return block?.type === 'text' ? JSON.parse(block.text) : null;
}
