import type { Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPayable } from '../src/create-payable';
import { isCheckoutSessionReconciliationCapable } from '../src/domain/contracts/checkout-session-reconciliation.contract';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const OPTIONS = {
  path: 'merchant',
  apiToken: '',
  channelId: 2452,
  channelSecret: 'secret-for-the-channel',
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
};

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    uuid: 'booking-uuid',
    trust_id: 'trust-44',
    status: 'confirmed',
    firstname: 'Ada',
    surname: 'Lovelace',
    email: 'ada@example.test',
    date: '2030-02-01',
    total: 9999,
    total_unpaid: 9999,
    currencies: 'EUR',
    countries: 'PT',
    transaction_ids: [],
    channels: 2452,
    ...overrides,
  };
}

function respondWith(payload: Record<string, unknown>) {
  return vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function fixture(databases: Knex[], fetch: ReturnType<typeof respondWith>) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(NOW);
  const storage = new KnexStorageDriver(database, clock);
  const provider = new TrustMyTravelProvider({ ...OPTIONS, clock, fetch });
  const payable = createPayable({ providers: { tmt: provider }, storage, clock });
  const customer = await storage.customers.create(makeCustomer());
  const payment = await storage.payments.create({
    tenantId: null,
    customerId: customer.id,
    provider: 'tmt',
    providerPaymentId: '44',
    status: 'pending',
    currency: 'EUR',
    amount: 9999,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
  return { payable, storage, provider, payment };
}

describe('Trust My Travel unsettled checkout reconciliation', () => {
  const databases: Knex[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('closes a redirect payment whose attempt never settled', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({ outcome: 'unsettled', status: 'failed', paymentUpdated: true });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('failed');
  });

  it('reports the transactions instead of closing a checkout that did settle', async () => {
    const fetch = respondWith(booking({ transaction_ids: [77], total_unpaid: 0 }));
    const { payable, storage, payment } = await fixture(databases, fetch);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({
      outcome: 'settled',
      providerPaymentIds: ['77'],
      paymentUpdated: false,
    });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses to close a payment whose amount does not match the booking', async () => {
    const fetch = respondWith(booking({ total: 5000, total_unpaid: 5000 }));
    const { payable, storage, payment } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH' });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses a booking outside the configured channel', async () => {
    const fetch = respondWith(booking({ channels: 9999 }));
    const { payable } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_SCOPE_MISMATCH' });
  });

  it('refuses a booking that reports no transactions while claiming to be partly paid', async () => {
    const fetch = respondWith(booking({ total_unpaid: 4000 }));
    const { payable } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_SETTLEMENT_UNCLEAR' });
  });

  it.each([
    ['0'],
    ['-1'],
    ['44.5'],
    ['abc'],
    [''],
  ])('refuses the checkout session id %p without reading a booking', async (checkoutSessionId) => {
    const fetch = respondWith(booking());
    const { payable } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CHECKOUT_SESSION_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves an already failed payment alone instead of rewriting it', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch);
    await storage.payments.update(payment.id, { status: 'failed' }, null);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({ outcome: 'unsettled', paymentUpdated: false });
  });

  it('is discoverable as a provider capability', async () => {
    const fetch = respondWith(booking());
    const { provider } = await fixture(databases, fetch);

    expect(isCheckoutSessionReconciliationCapable(provider)).toBe(true);
  });
});
