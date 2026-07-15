import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { ChargeInput, ChargeResultDTO } from '../src/domain/dtos/charge.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../src/domain/dtos/checkout.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

class KeyedProvider extends FakeProvider {
  readonly chargeKeys: Array<string | undefined> = [];
  readonly checkoutKeys: Array<string | undefined> = [];

  override async charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
    this.chargeKeys.push(ctx.idempotencyKey);
    return {
      providerPaymentId: `pi_${ctx.idempotencyKey ?? 'anon'}`,
      status: 'succeeded',
      amount: input.amount,
    };
  }

  override async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    this.checkoutKeys.push(ctx.idempotencyKey);
    this.lastCheckout = { input, ctx };
    return { id: `cs_${ctx.idempotencyKey ?? 'anon'}`, url: 'https://fake.test/cs' };
  }
}

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(db, clock);
  const provider = new KeyedProvider();
  const payable = createPayable({
    providers: { stripe: provider },
    storage,
    idempotency: { store: new KnexIdempotencyRepository(db, clock) },
  });
  return { db, storage, provider, payable };
}

describe('provider side-effect recovery through core idempotency', () => {
  it('records a durable processing attempt before the provider charge runs', async () => {
    const { db, provider, payable } = await setup();
    const store = new KnexIdempotencyRepository(db, new FakeClock());
    const statuses: Array<string | undefined> = [];
    const originalCharge = provider.charge.bind(provider);
    provider.charge = async (input, ctx) => {
      const record = await store.find(`payment:${ctx.idempotencyKey ?? ''}`);
      statuses.push(record?.status);
      return originalCharge(input, ctx);
    };

    await payable.customer(billable).charge({
      amount: Money.of(1000, 'USD'),
      reference: 'order-durable',
    });

    expect(statuses).toEqual(['processing']);
    await db.destroy();
  });

  it('recovers a charge whose local persistence failed after the provider succeeded', async () => {
    const { db, storage, provider, payable } = await setup();
    const originalCreate = storage.payments.create.bind(storage.payments);
    let failures = 0;
    storage.payments.create = async (data) => {
      failures += 1;
      if (failures === 1) {
        throw new Error('database connection lost');
      }
      return originalCreate(data);
    };

    const request = { amount: Money.of(2500, 'USD'), reference: 'order-recover' };
    await expect(payable.customer(billable).charge(request)).rejects.toThrow(
      'database connection lost',
    );

    const second = await payable.customer(billable).charge(request);

    expect(provider.chargeKeys).toHaveLength(2);
    expect(provider.chargeKeys[0]).toBe(provider.chargeKeys[1]);
    expect(second.providerPaymentId).toBe(`pi_${provider.chargeKeys[0]}`);
    const payments = await payable.customer(billable).payments();
    expect(payments).toHaveLength(1);
    await db.destroy();
  });

  it('links to the existing payment when a lost response is retried', async () => {
    const { db, provider, payable } = await setup();
    const request = { amount: Money.of(4000, 'USD'), reference: 'order-lost-response' };

    const first = await payable.customer(billable).charge(request);
    const second = await payable.customer(billable).charge(request);

    expect(second.id).toBe(first.id);
    expect(provider.chargeKeys).toHaveLength(1);
    const payments = await payable.customer(billable).payments();
    expect(payments).toHaveLength(1);
    await db.destroy();
  });

  it('runs redirect checkout creation through the idempotency service', async () => {
    const { db, provider, payable } = await setup();

    const first = await payable
      .customer(billable)
      .redirectCheckout(Money.of(9900, 'USD'))
      .create({ reference: 'order-checkout' });
    const second = await payable
      .customer(billable)
      .redirectCheckout(Money.of(9900, 'USD'))
      .create({ reference: 'order-checkout' });

    expect(provider.checkoutKeys).toHaveLength(1);
    expect(second.id).toBe(first.id);
    const payments = await payable.customer(billable).payments();
    expect(payments).toHaveLength(1);
    await db.destroy();
  });

  it('reuses the provider key when a failed checkout is retried', async () => {
    const { db, provider, payable } = await setup();
    const originalCheckout = provider.createCheckoutSession.bind(provider);
    let attempts = 0;
    provider.createCheckoutSession = async (input, ctx) => {
      attempts += 1;
      if (attempts === 1) {
        provider.checkoutKeys.push(ctx.idempotencyKey);
        throw new Error('gateway timeout');
      }
      return originalCheckout(input, ctx);
    };

    const create = () =>
      payable
        .customer(billable)
        .redirectCheckout(Money.of(5000, 'USD'))
        .create({ reference: 'order-retry-checkout' });

    await expect(create()).rejects.toThrow('gateway timeout');
    const session = await create();

    expect(provider.checkoutKeys).toHaveLength(2);
    expect(provider.checkoutKeys[0]).toBe(provider.checkoutKeys[1]);
    expect(session.id).toBe(`cs_${provider.checkoutKeys[0]}`);
    await db.destroy();
  });
});
