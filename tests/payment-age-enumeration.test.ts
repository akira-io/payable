import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { PaymentRepository } from '../src/domain/contracts/payment-repository.contract';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

const OLD = new Date('2026-01-01T00:00:00.000Z');
const RECENT = new Date('2026-01-09T00:00:00.000Z');
const CUTOFF = new Date('2026-01-05T00:00:00.000Z');

async function fixture(databases: Knex[]) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(OLD);
  const storage = new KnexStorageDriver(database, clock);
  const customer = await storage.customers.create(makeCustomer());
  const payments = storage.payments;

  async function pending(providerPaymentId: string, createdAt: Date): Promise<string> {
    clock.set(createdAt);
    const payment = await payments.create({
      tenantId: null,
      customerId: customer.id,
      provider: 'trust-my-travel',
      providerPaymentId,
      status: 'pending',
      currency: 'EUR',
      amount: 9999,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    return payment.id;
  }

  return { payments, pending };
}

function page(payments: PaymentRepository) {
  const paginate = payments.page;
  if (!paginate) throw new Error('the knex payment repository must support collection queries');
  return paginate.bind(payments);
}

describe('payment enumeration by age', () => {
  const databases: Knex[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('enumerates only the pending payments older than the cutoff', async () => {
    const { payments, pending } = await fixture(databases);
    const stuck = await pending('44', OLD);
    await pending('91', RECENT);

    const result = await page(payments)(
      { limit: 10, status: 'pending', createdBefore: CUTOFF },
      null,
    );

    expect(result.items.map((payment) => payment.id)).toEqual([stuck]);
    expect(result.hasMore).toBe(false);
  });

  it('keeps the cutoff exclusive so a payment created at the boundary is not swept', async () => {
    const { payments, pending } = await fixture(databases);
    await pending('44', CUTOFF);

    const result = await page(payments)(
      { limit: 10, status: 'pending', createdBefore: CUTOFF },
      null,
    );

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('refuses a cursor issued for a different cutoff', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(OLD);
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({ providers: {}, storage, clock });
    const customer = await storage.customers.create(makeCustomer());
    for (const providerPaymentId of ['44', '91']) {
      await storage.payments.create({
        tenantId: null,
        customerId: customer.id,
        provider: 'trust-my-travel',
        providerPaymentId,
        status: 'pending',
        currency: 'EUR',
        amount: 9999,
        refundedAmount: 0,
        reference: null,
        description: null,
      });
    }
    const payments = payable.storedPayments();

    const first = await payments.list({ limit: 1, status: 'pending', createdBefore: CUTOFF });
    expect(first.nextCursor).not.toBeNull();

    await expect(
      payments.list({
        limit: 1,
        status: 'pending',
        createdBefore: RECENT,
        cursor: first.nextCursor ?? '',
      }),
    ).rejects.toMatchObject({ code: 'COLLECTION_CURSOR_INVALID' });
  });

  it('pages through one cutoff without losing or repeating a payment', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(OLD);
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({ providers: {}, storage, clock });
    const customer = await storage.customers.create(makeCustomer());
    const created: string[] = [];
    for (const [providerPaymentId, createdAt] of [
      ['44', OLD],
      ['91', new Date('2026-01-02T00:00:00.000Z')],
    ] as const) {
      clock.set(createdAt);
      const payment = await storage.payments.create({
        tenantId: null,
        customerId: customer.id,
        provider: 'trust-my-travel',
        providerPaymentId,
        status: 'pending',
        currency: 'EUR',
        amount: 9999,
        refundedAmount: 0,
        reference: null,
        description: null,
      });
      created.push(payment.id);
    }
    const payments = payable.storedPayments();

    const pageOne = await payments.list({ limit: 1, status: 'pending', createdBefore: CUTOFF });
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await payments.list({
      limit: 1,
      status: 'pending',
      createdBefore: CUTOFF,
      cursor: pageOne.nextCursor ?? '',
    });

    expect([...pageOne.items, ...pageTwo.items].map((payment) => payment.id)).toEqual([
      created[1],
      created[0],
    ]);
  });

  it('leaves the enumeration unfiltered when no cutoff is given', async () => {
    const { payments, pending } = await fixture(databases);
    const stuck = await pending('44', OLD);
    const recent = await pending('91', RECENT);

    const result = await page(payments)({ limit: 10, status: 'pending' }, null);

    expect(result.items.map((payment) => payment.id)).toEqual([recent, stuck]);
  });
});
