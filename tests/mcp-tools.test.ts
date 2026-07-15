import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { ChargeInput, ChargeResultDTO } from '../src/domain/dtos/charge.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateCustomerInput } from '../src/domain/dtos/customer.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { tenantFrom } from '../src/presentation/mcp/context';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import type { McpPayableOptions } from '../src/presentation/mcp/options';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class UniqueProvider extends FakeProvider {
  productCalls = 0;

  private sequence = 0;

  override async createProduct(
    ...args: Parameters<FakeProvider['createProduct']>
  ): ReturnType<FakeProvider['createProduct']> {
    this.productCalls += 1;
    return super.createProduct(...args);
  }

  override async createCustomer(
    input: CreateCustomerInput,
    _ctx: OperationContext,
  ): Promise<{ providerCustomerId: string; email: string; name: string | null }> {
    this.sequence += 1;
    return { providerCustomerId: `cus_${this.sequence}`, email: input.email, name: null };
  }

  override async charge(input: ChargeInput, _ctx: OperationContext): Promise<ChargeResultDTO> {
    this.sequence += 1;
    return { providerPaymentId: `pi_${this.sequence}`, status: 'succeeded', amount: input.amount };
  }
}

async function connect(options?: McpPayableOptions) {
  const db = createTestDb();
  await migrate(db);
  const storage = new KnexStorageDriver(db, new FakeClock());
  const provider = new UniqueProvider();
  const payable = createPayable({ providers: { stripe: provider }, storage });
  const server = createPayableMcpServer(payable, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, payable, provider, storage, db };
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== 'text') {
    throw new Error('expected text content');
  }
  return JSON.parse(block.text);
}

const billable = { billableType: 'User', billableId: '1', email: 'user@test.dev' };

describe('mcp tools', () => {
  it('lists configured providers', async () => {
    const { client, db } = await connect();
    const result = (await client.callTool({
      name: 'providers_list',
      arguments: {},
    })) as CallToolResult;
    expect(parse(result)).toEqual(['stripe']);
    await db.destroy();
  });

  it('reads a charged payment through global payments_list', async () => {
    const { client, payable, db } = await connect();
    await payable.customer(billable).charge({ amount: Money.of(900, 'USD') });

    const result = (await client.callTool({
      name: 'payments_list',
      arguments: {},
    })) as CallToolResult;
    const payments = parse(result) as Array<{ amount: number; currency: string }>;

    expect(payments).toHaveLength(1);
    expect(payments[0]?.amount).toBe(900);
    await db.destroy();
  });

  it('charges via the money tool with coerced Money input', async () => {
    const { client, db } = await connect({ policy: { allowMoneyMovement: true } });

    const result = (await client.callTool({
      name: 'charge',
      arguments: { billable, amount: { amount: 1500, currency: 'USD' } },
    })) as CallToolResult;
    const payment = parse(result) as { amount: number; status: string };

    expect(payment.amount).toBe(1500);
    expect(payment.status).toBe('succeeded');
    await db.destroy();
  });

  it('returns a structured error for unknown payments', async () => {
    const { client, db } = await connect();
    const result = (await client.callTool({
      name: 'refunds_list',
      arguments: { paymentId: 'missing' },
    })) as CallToolResult;
    expect(parse(result)).toEqual([]);
    await db.destroy();
  });

  it('refuses invoice_pdf for an invoice owned by another billable', async () => {
    const { client, payable, storage, db } = await connect();
    const owner = await payable.customers().create(billable);
    await storage.invoices.create({
      tenantId: null,
      customerId: owner.id,
      subscriptionId: null,
      provider: 'stripe',
      providerInvoiceId: 'in_owned',
      status: 'paid',
      currency: 'USD',
      total: 9900,
      amountPaid: 9900,
      amountDue: 0,
      number: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });

    const intruder = (await client.callTool({
      name: 'invoice_pdf',
      arguments: {
        billable: { billableType: 'User', billableId: '2', email: 'intruder@test.dev' },
        providerInvoiceId: 'in_owned',
      },
    })) as CallToolResult;
    expect(intruder.isError).toBe(true);
    expect((parse(intruder) as { error: string }).error).toBe('INVOICE_NOT_FOUND');

    const granted = (await client.callTool({
      name: 'invoice_pdf',
      arguments: { billable, providerInvoiceId: 'in_owned' },
    })) as CallToolResult;
    expect(granted.isError).toBeUndefined();
    await db.destroy();
  });
});

describe('mcp execution-time authorization', () => {
  const denyAll = {
    policy: { allowMoneyMovement: true, authorization: () => ({ allowed: false }) },
  } satisfies McpPayableOptions;

  const deniedCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: 'product_create', arguments: { name: 'Pro Plan' } },
    { name: 'product_update', arguments: { providerProductId: 'prod_1', name: 'Pro' } },
    {
      name: 'price_create',
      arguments: { providerProductId: 'prod_1', unitAmount: { amount: 900, currency: 'USD' } },
    },
    {
      name: 'subscription_create',
      arguments: { billable, name: 'default', priceId: 'price_1' },
    },
    { name: 'subscription_cancel', arguments: { billable, name: 'default' } },
    {
      name: 'checkout_create',
      arguments: {
        billable,
        name: 'default',
        priceId: 'price_1',
        successUrl: 'https://ok.test',
        cancelUrl: 'https://ko.test',
      },
    },
    { name: 'billing_portal', arguments: { billable, returnUrl: 'https://back.test' } },
    { name: 'charge', arguments: { billable, amount: { amount: 500, currency: 'USD' } } },
    { name: 'refund', arguments: { paymentId: 'pay_1' } },
    { name: 'webhook_replay', arguments: { id: 'evt_1' } },
  ];

  for (const call of deniedCalls) {
    it(`denies ${call.name} when the authorization callback rejects`, async () => {
      const { client, db } = await connect(denyAll);
      const result = (await client.callTool(call)) as CallToolResult;
      expect(result.isError).toBe(true);
      expect((parse(result) as { error: string }).error).toBe('AUTHORIZATION_DENIED');
      await db.destroy();
    });
  }

  it('does not touch the provider when a catalog write is denied', async () => {
    const { client, provider, db } = await connect(denyAll);
    await client.callTool({ name: 'product_create', arguments: { name: 'Pro Plan' } });
    expect(provider.productCalls).toBe(0);
    await db.destroy();
  });

  it('allows catalog writes when the callback authorizes an actor', async () => {
    const { client, db } = await connect({
      policy: { authorization: () => ({ allowed: true, actorId: 'svc' }) },
    });
    const result = (await client.callTool({
      name: 'product_create',
      arguments: { name: 'Pro Plan' },
    })) as CallToolResult;
    expect(result.isError).toBeUndefined();
    expect((parse(result) as { name: string }).name).toBe('Pro Plan');
    await db.destroy();
  });
});

describe('mcp tenantFrom', () => {
  it('ignores a client tenantId when a default is pinned', () => {
    expect(tenantFrom({ tenantId: 'attacker' }, { defaultTenantId: 'tenant-a' })).toBe('tenant-a');
  });

  it('honors the client tenantId when override is explicitly allowed', () => {
    expect(
      tenantFrom(
        { tenantId: 'tenant-b' },
        { defaultTenantId: 'tenant-a', allowTenantOverride: true },
      ),
    ).toBe('tenant-b');
  });

  it('ignores a client tenantId when no default is pinned and override is disallowed', () => {
    expect(tenantFrom({ tenantId: 'attacker' }, {})).toBeUndefined();
  });

  it('honors the client tenantId when override is allowed and no default is pinned', () => {
    expect(tenantFrom({ tenantId: 'tenant-c' }, { allowTenantOverride: true })).toBe('tenant-c');
  });

  it('uses the pinned default when override is allowed but no client tenantId is given', () => {
    expect(tenantFrom({}, { defaultTenantId: 'tenant-a', allowTenantOverride: true })).toBe(
      'tenant-a',
    );
  });
});
