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

interface PaymentOverrides {
  tenantId?: string | null;
  amount?: number;
  currency?: string;
  status?: 'pending' | 'authorized' | 'failed' | 'succeeded';
  providerPaymentId?: string;
}

async function fixture(
  databases: Knex[],
  fetch: ReturnType<typeof respondWith>,
  payments: PaymentOverrides[] = [{}],
) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(NOW);
  const storage = new KnexStorageDriver(database, clock);
  const provider = new TrustMyTravelProvider({ ...OPTIONS, clock, fetch });
  const payable = createPayable({ providers: { tmt: provider }, storage, clock });
  const created = [];
  for (const overrides of payments) {
    const tenantId = overrides.tenantId ?? null;
    const customer = await storage.customers.create({ ...makeCustomer(), tenantId });
    created.push(
      await storage.payments.create({
        tenantId,
        customerId: customer.id,
        provider: 'tmt',
        providerPaymentId: overrides.providerPaymentId ?? '44',
        status: overrides.status ?? 'pending',
        currency: overrides.currency ?? 'EUR',
        amount: overrides.amount ?? 9999,
        refundedAmount: 0,
        reference: null,
        description: null,
      }),
    );
  }
  const payment = created[0];
  if (!payment) throw new Error('the fixture must create at least one payment');
  return { payable, storage, provider, payment, payments: created };
}

function requestedUrls(fetch: ReturnType<typeof respondWith>): string[] {
  return fetch.mock.calls.map(([target]) =>
    typeof target === 'string' ? target : target instanceof URL ? target.toString() : target.url,
  );
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

    expect(result).toMatchObject({
      outcome: 'unsettled',
      checkoutSessionId: '44',
      status: 'failed',
      paymentUpdated: true,
    });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('failed');
  });

  it('never advances the provider payment id off the booking it closed', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch);

    await payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' });

    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.providerPaymentId).toBe('44');
  });

  it('reads the booking named by the checkout session id', async () => {
    const fetch = respondWith(booking());
    const { payable } = await fixture(databases, fetch);

    await payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' });

    expect(requestedUrls(fetch)).toEqual([expect.stringContaining('/bookings/44')]);
  });

  it('records the closure in the audit log under the payment tenant', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [{ tenantId: 'acme' }]);

    await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      tenantId: 'acme',
      checkoutSessionId: '44',
    });

    const entries = await storage.auditLogs.list({ resourceType: 'payment', tenantId: 'acme' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: 'acme',
      action: 'payment.checkout_unsettled',
      resourceType: 'payment',
      resourceId: payment.id,
      before: { status: 'pending' },
      after: { status: 'failed' },
      metadata: {
        provider: 'tmt',
        checkoutSessionId: '44',
        source: 'checkout_reconciliation',
      },
    });
    expect(entries[0]?.correlationId).toEqual(expect.any(String));
  });

  it('closes a deposit payment worth less than the booking it draws against', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [{ amount: 3000 }]);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({ outcome: 'unsettled', paymentUpdated: true });
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
      checkoutSessionId: '44',
      bookingTransactionIds: ['77'],
      paymentUpdated: false,
    });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses a booking that does not cover the payment', async () => {
    const fetch = respondWith(booking({ total: 5000, total_unpaid: 5000 }));
    const { payable, storage, payment } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH' });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses a booking whose currency is not the currency of the payment', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [
      { currency: 'USD', amount: 3000 },
    ]);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH' });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses a response that carries a different booking than the one requested', async () => {
    const fetch = respondWith(booking({ id: 77 }));
    const { payable, storage, payment } = await fixture(databases, fetch);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_ID_MISMATCH' });
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
    ['9007199254740993'],
  ])('refuses the checkout session id %p without reading a booking', async (checkoutSessionId) => {
    const fetch = respondWith(booking());
    const { payable } = await fixture(databases, fetch, [{ providerPaymentId: checkoutSessionId }]);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CHECKOUT_SESSION_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a checkout session no stored payment carries, without reading a booking', async () => {
    const fetch = respondWith(booking());
    const { payable } = await fixture(databases, fetch, [{ providerPaymentId: '45' }]);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to close the payment of another tenant', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [{ tenantId: 'acme' }]);

    await expect(
      payable.reconcileUnsettledCheckout({
        provider: 'tmt',
        tenantId: 'other',
        checkoutSessionId: '44',
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
    const stored = await storage.payments.findById(payment.id, 'acme');
    expect(stored?.status).toBe('pending');
  });

  it('refuses a tenant payment for a caller that names no tenant', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [{ tenantId: 'acme' }]);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
    const stored = await storage.payments.findById(payment.id, 'acme');
    expect(stored?.status).toBe('pending');
  });

  it('leaves an authorized payment alone instead of failing a live authorization', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [
      { status: 'authorized' },
    ]);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({ outcome: 'unsettled', paymentUpdated: false });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('authorized');
    expect(await storage.auditLogs.list({ resourceType: 'payment' })).toEqual([]);
  });

  it('leaves an already failed payment alone instead of rewriting it', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch, [{ status: 'failed' }]);

    const result = await payable.reconcileUnsettledCheckout({
      provider: 'tmt',
      checkoutSessionId: '44',
    });

    expect(result).toMatchObject({ outcome: 'unsettled', paymentUpdated: false });
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.updatedAt).toEqual(payment.updatedAt);
    expect(await storage.auditLogs.list({ resourceType: 'payment' })).toEqual([]);
  });

  it('no longer reaches a payment whose provider id a callback already advanced', async () => {
    const fetch = respondWith(booking());
    const { payable, storage, payment } = await fixture(databases, fetch);
    await storage.payments.update(payment.id, { providerPaymentId: '77' }, null);

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
    const stored = await storage.payments.findById(payment.id, null);
    expect(stored?.status).toBe('pending');
  });

  it('refuses to reconcile without a storage driver', async () => {
    const fetch = respondWith(booking());
    const clock = new FakeClock(NOW);
    const provider = new TrustMyTravelProvider({ ...OPTIONS, clock, fetch });
    const payable = createPayable({ providers: { tmt: provider }, clock });

    await expect(
      payable.reconcileUnsettledCheckout({ provider: 'tmt', checkoutSessionId: '44' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_STORAGE_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is discoverable as a provider capability', async () => {
    const fetch = respondWith(booking());
    const { provider } = await fixture(databases, fetch);

    expect(isCheckoutSessionReconciliationCapable(provider)).toBe(true);
  });
});
