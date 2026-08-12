import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: 'local', email: 'local@example.com' };
const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('local payment adapters', () => {
  it('records and replays an authorized canonical local payment over Fastify', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({
      storage,
      clock,
      authorization: { enabled: true },
      idempotency: { store: new KnexIdempotencyRepository(database, clock) },
    });
    const customer = await payable.customers().create(billable);
    const app = Fastify();
    await app.register(
      createFastifyPayablePlugin(payable, {
        resolveAuthorization: () => ({ allowed: true, actorType: 'service', actorId: 'cashier-1' }),
      }),
      { prefix: '/payable' },
    );
    const request = {
      method: 'POST' as const,
      url: '/payable/canonical/payments/local',
      headers: { 'idempotency-key': 'receipt-http-1' },
      payload: {
        customerId: customer.id,
        amount: 1500,
        currency: 'EUR',
        status: 'succeeded',
        collectionMethod: 'cash',
        externalReference: 'receipt-http-1',
      },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({ provider: null, recordedBy: 'cashier-1' });
    await app.close();
  });

  it('records, refunds, and voids providerless payments through MCP', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const payable = createPayable({
      storage: new KnexStorageDriver(database, new FakeClock()),
      tenant: { enabled: true },
    });
    const customer = await payable.customers(undefined, 'tenant-local').create(billable);
    const server = createPayableMcpServer(payable, {
      defaultTenantId: 'tenant-local',
      policy: { allowMoneyMovement: true },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'local-payments-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const recorded = await call(client, 'canonical_payment_record_local', {
      customerId: customer.id,
      amount: { amount: 2500, currency: 'EUR' },
      status: 'succeeded',
      collectionMethod: 'cash',
      externalReference: 'receipt-42',
    });
    const payment = parse(recorded) as { id: string; provider: null };
    const refunded = await call(client, 'canonical_payment_refund_local', {
      paymentId: payment.id,
      amount: { amount: 500, currency: 'EUR' },
      collectionMethod: 'cash',
      externalReference: 'return-42',
    });
    expect(parse(refunded)).toMatchObject({ paymentId: payment.id, provider: null, amount: 500 });
    const pending = await payable.storedPayments('tenant-local').record({
      customerId: customer.id,
      amount: Money.of(800, 'EUR'),
      status: 'pending',
      collectionMethod: 'cheque',
    });
    const voided = await call(client, 'canonical_payment_void_local', { paymentId: pending.id });
    expect(parse(voided)).toMatchObject({ id: pending.id, status: 'canceled' });
  });
});

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('expected text content');
  }
  return JSON.parse(block.text);
}
