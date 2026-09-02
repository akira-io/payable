import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { FakeClock } from '../src/support/clock/fake-clock';

const OPTIONS = {
  path: 'merchant',
  apiToken: 'api-token',
  channelId: 2452,
  channelSecret: 'channel-secret',
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
  clock: new FakeClock(new Date('2030-01-02T03:04:05.000Z')),
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TrustMyTravelProvider', () => {
  it('creates a booking and returns a pinned Payment Modal configuration', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 44,
        uuid: 'booking-uuid',
        trust_id: '3-44',
        status: 'unpaid',
        firstname: 'Jane',
        surname: 'Doe',
        email: 'jane@example.org',
        date: '2030-05-12',
        total: 9999,
        total_unpaid: 9999,
        currencies: 'EUR',
        countries: 'PT',
        channels: 2452,
        transaction_ids: [],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const session = await provider.createCheckoutSession(
      {
        providerCustomerId: '',
        mode: 'payment',
        lineItems: [],
        successUrl: 'https://shop.test/success',
        cancelUrl: 'https://shop.test/cancel',
        reference: 'ORDER-42',
        amount: Money.of(9999, 'EUR'),
        providerData: {
          booking: {
            firstname: 'Jane',
            surname: 'Doe',
            email: 'jane@example.org',
            date: '2030-05-12',
            countries: 'PT',
          },
          modal: {
            booking_auth: 'attacker-controlled',
            booking_id: 999,
            channels: 999,
            currencies: 'USD',
            total: 1,
            payee_name: 'Jane Doe',
            payee_email: 'jane@example.org',
            payee_address: '1 Main Street',
            payee_city: 'Lisbon',
            payee_postcode: '1000-001',
            payee_country: 'PT',
          },
        },
      },
      { correlationId: 'corr-1', idempotencyKey: 'idem-1' },
    );

    const html = session.html ?? '';
    expect(session.id).toBe('44');
    expect(session.url).toBe('https://payment.tmtprotects.com');
    expect(html).toContain('tmt-payment-modal.3.6.1.js');
    expect(html).toContain('window.tmtPaymentModalReady=function()');
    expect(html).toContain('window.buPaymentTrustMyTravelModal=new window.tmtPaymentModalSdk');
    expect(html).toContain('new CustomEvent("bu-payment:tmt-modal-ready"');
    expect(html.indexOf('window.tmtPaymentModalReady')).toBeLessThan(
      html.indexOf('tmt-payment-modal.3.6.1.js'),
    );
    expect(html).toContain('"path":"merchant"');
    expect(html).toContain('"booking_id":44');
    expect(html).toContain('"channels":2452');
    expect(html).toContain('"currencies":"EUR"');
    expect(html).toContain('"total":9999');
    expect(html).not.toContain('attacker-controlled');
    expect(html).toContain('"environment":"test"');
    expect(html).toContain('"allocations":[]');
    expect(html).toContain('"verify":["allocations","reference"]');
    expect(html).not.toContain(OPTIONS.channelSecret);
    expect(fetch).toHaveBeenCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/bookings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reuses an existing booking instead of creating another one', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 44,
        firstname: 'Jane',
        surname: 'Doe',
        email: 'jane@example.org',
        date: '2030-05-12',
        total: 9999,
        total_unpaid: 6999,
        currencies: 'EUR',
        countries: 'PT',
        channels: 2452,
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const session = await provider.createCheckoutSession(
      {
        providerCustomerId: '',
        mode: 'payment',
        lineItems: [],
        successUrl: '',
        cancelUrl: '',
        amount: Money.of(3000, 'EUR'),
        providerData: {
          bookingId: 44,
          modal: {
            payee_name: 'Jane Doe',
            payee_email: 'jane@example.org',
            payee_address: '1 Main Street',
            payee_city: 'Lisbon',
            payee_postcode: '1000-001',
            payee_country: 'PT',
          },
        },
      },
      { correlationId: 'corr-1' },
    );

    expect(session.id).toBe('44');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/bookings/44',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('requires the Payment Modal payer fields before returning executable HTML', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse({ id: 44, total: 9999, currencies: 'EUR', channels: 2452 }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.createCheckoutSession(
        {
          providerCustomerId: '',
          mode: 'payment',
          lineItems: [],
          successUrl: '',
          cancelUrl: '',
          amount: Money.of(9999, 'EUR'),
          providerData: { bookingId: 44 },
        },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_MODAL_DATA_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates the Payment Modal version before creating or loading a booking', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, modalVersion: 'latest', fetch });

    await expect(
      provider.createCheckoutSession(
        {
          providerCustomerId: '',
          mode: 'payment',
          lineItems: [],
          successUrl: '',
          cancelUrl: '',
          amount: Money.of(9999, 'EUR'),
          providerData: {
            bookingId: 44,
            modal: {
              payee_name: 'Jane Doe',
              payee_email: 'jane@example.org',
              payee_address: '1 Main Street',
              payee_city: 'Lisbon',
              payee_postcode: '1000-001',
              payee_country: 'PT',
            },
          },
        },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_MODAL_VERSION_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a checkout amount in a currency other than the configured channel currency', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.createCheckoutSession(
        {
          providerCustomerId: '',
          mode: 'payment',
          lineItems: [],
          successUrl: '',
          cancelUrl: '',
          amount: Money.of(3000, 'USD'),
          providerData: {
            bookingId: 44,
            modal: {
              payee_name: 'Jane Doe',
              payee_email: 'jane@example.org',
              payee_address: '1 Main Street',
              payee_city: 'Lisbon',
              payee_postcode: '1000-001',
              payee_country: 'PT',
            },
          },
        },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_CURRENCY_MISMATCH' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an existing booking from another channel before rendering the modal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 44,
        total: 9999,
        currencies: 'EUR',
        channels: 9999,
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.createCheckoutSession(
        {
          providerCustomerId: '',
          mode: 'payment',
          lineItems: [],
          successUrl: '',
          cancelUrl: '',
          amount: Money.of(9999, 'EUR'),
          providerData: {
            bookingId: 44,
            modal: {
              payee_name: 'Jane Doe',
              payee_email: 'jane@example.org',
              payee_address: '1 Main Street',
              payee_city: 'Lisbon',
              payee_postcode: '1000-001',
              payee_country: 'PT',
            },
          },
        },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_MISMATCH' });
  });

  it('advertises checkout, refunds and TMT booking access only', () => {
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch: vi.fn() });

    expect([...provider.capabilities()]).toEqual(['checkout', 'refunds', 'x-tmt-bookings']);
    expect(provider.subscriptionOperationCapabilities().create).toEqual({
      checkout: false,
      direct: false,
    });
  });
});
