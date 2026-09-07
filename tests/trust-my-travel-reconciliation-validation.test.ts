import { describe, expect, it, vi } from 'vitest';
import { FakeClock, TrustMyTravelProvider } from '../src';

const OPTIONS = {
  path: 'merchant',
  apiToken: '',
  channelId: 2452,
  channelSecret: '',
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
  clock: new FakeClock(new Date('2030-01-02T03:04:05.000Z')),
};

function respondWith(transaction: Record<string, unknown>) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(transaction), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  return { fetch, provider: new TrustMyTravelProvider({ ...OPTIONS, fetch }) };
}

function settledTransaction(bookings: unknown) {
  return {
    id: 77,
    status: 'complete',
    total: 9999,
    currencies: 'EUR',
    channels: 2452,
    bookings,
  };
}

describe('Trust My Travel reconciliation validation', () => {
  it('rejects a successful response without a provider status instead of inventing state', async () => {
    const { provider } = respondWith({
      id: 77,
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [],
    });

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_TRANSACTION_RESPONSE_INVALID' });
  });

  it.each([
    [undefined],
    [null],
    ['44'],
  ])('rejects a response whose bookings field is %s as malformed, not as a foreign booking', async (bookings) => {
    const { provider } = respondWith(settledTransaction(bookings));

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_TRANSACTION_RESPONSE_INVALID' });
  });

  it('rejects a blank provider payment id before contacting TMT', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.reconcilePaymentRecurring({ providerPaymentId: '' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_INPUT_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [undefined],
  ])('refuses to reconcile without the booking the payment belongs to', async (providerData) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.reconcilePaymentRecurring({ providerPaymentId: '77', providerData }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_RECONCILIATION_BOOKING_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['44'],
    [0],
    [-1],
    [44.5],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1],
  ])('refuses the booking id %p as its own input error, before contacting TMT', async (bookingId) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_ID_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a payment whose provider payment id is still its booking id', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '44',
        providerData: { bookingId: 44 },
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TMT_RECONCILIATION_BOOKING_UNSETTLED',
      context: { bookingId: 44 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a transaction that settled a different booking', async () => {
    const { provider } = respondWith(
      settledTransaction([{ id: 91, currencies: 'EUR', total: 9999 }]),
    );

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TMT_TRANSACTION_BOOKING_MISMATCH',
      context: { bookingId: 44 },
    });
  });

  it('refuses a bookings entry that is not an allocation without crashing', async () => {
    const { provider } = respondWith(settledTransaction([null]));

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_TRANSACTION_BOOKING_MISMATCH' });
  });

  it('accepts the payment booking anywhere in a multi-booking transaction', async () => {
    const { provider } = respondWith(
      settledTransaction([
        { id: 91, currencies: 'EUR', total: 4999 },
        { id: 44, currencies: 'EUR', total: 5000 },
      ]),
    );

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).resolves.toMatchObject({ outcome: 'terminal', status: 'succeeded' });
  });

  it('accepts a booking id the provider serialised as a string', async () => {
    const { provider } = respondWith(
      settledTransaction([{ id: '44', currencies: 'EUR', total: 9999 }]),
    );

    await expect(
      provider.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).resolves.toMatchObject({ outcome: 'terminal', status: 'succeeded' });
  });
});
