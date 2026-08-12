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
import { requireRequestIdempotencyKey } from '../src/presentation/shared/catalog-idempotency';
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
    const missingKey = await app.inject({
      ...request,
      headers: {},
      payload: { ...request.payload, externalReference: 'receipt-without-key' },
    });
    const malformedKey = await app.inject({
      ...request,
      headers: { 'idempotency-key': ' invalid-key ' },
      payload: { ...request.payload, externalReference: 'receipt-malformed-key' },
    });
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(missingKey.statusCode).toBe(400);
    expect(malformedKey.statusCode).toBe(400);
    expect(first.json()).toMatchObject({ provider: null, recordedBy: 'cashier-1' });
    const refund = await payable.storedPayments().refundLocal((first.json() as { id: string }).id, {
      amount: Money.of(500, 'EUR'),
      collectionMethod: 'cash',
      idempotencyKey: 'fastify-read-refund-1',
      authorization: { allowed: true, actorType: 'service', actorId: 'cashier-1' },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/payable/canonical/refunds?paymentId=${(first.json() as { id: string }).id}`,
    });
    const retrieved = await app.inject({
      method: 'GET',
      url: `/payable/canonical/refunds/${refund.id}`,
    });
    expect(listed.json()).toMatchObject({ items: [expect.objectContaining({ id: refund.id })] });
    expect(retrieved.json()).toMatchObject({ id: refund.id });
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
      idempotencyKey: 'mcp-local-payment-1',
    });
    const payment = parse(recorded) as { id: string; provider: null };
    const refunded = await call(client, 'canonical_payment_refund_local', {
      paymentId: payment.id,
      amount: { amount: 500, currency: 'EUR' },
      collectionMethod: 'cash',
      externalReference: 'return-42',
      idempotencyKey: 'mcp-local-refund-1',
    });
    expect(parse(refunded)).toMatchObject({ paymentId: payment.id, provider: null, amount: 500 });
    const refund = parse(refunded) as { id: string };
    await expect(call(client, 'canonical_refund_get', { id: refund.id })).resolves.toSatisfy(
      (result: CallToolResult) => (parse(result) as { id: string }).id === refund.id,
    );
    await expect(
      call(client, 'canonical_refunds_list', { paymentId: payment.id, limit: 1 }),
    ).resolves.toSatisfy(
      (result: CallToolResult) =>
        (parse(result) as { items: Array<{ id: string }> }).items[0]?.id === refund.id,
    );
    const pending = await payable.storedPayments('tenant-local').record({
      customerId: customer.id,
      amount: Money.of(800, 'EUR'),
      status: 'pending',
      collectionMethod: 'cheque',
    });
    const voided = await call(client, 'canonical_payment_void_local', {
      paymentId: pending.id,
      idempotencyKey: 'mcp-local-void-1',
    });
    expect(parse(voided)).toMatchObject({ id: pending.id, status: 'canceled' });
  });

  it('rejects repeated idempotency headers before an adapter mutation can run', () => {
    expect(() =>
      requireRequestIdempotencyKey({
        headers: { 'idempotency-key': 'repeated-key-a, repeated-key-b' },
        rawHeaders: ['Idempotency-Key', 'repeated-key-a', 'Idempotency-Key', 'repeated-key-b'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }));
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
