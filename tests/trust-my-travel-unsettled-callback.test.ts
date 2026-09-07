import { describe, expect, it, vi } from 'vitest';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';

const OPTIONS = {
  path: 'merchant',
  apiToken: 'api-token',
  channelId: 2452,
  channelSecret: 'channel-secret',
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('Trust My Travel unsettled callback reconciliation', () => {
  const failurePayload = {
    code: 'transaction_declined',
    message: 'The payment was declined',
    data: { status: 402, params: { status: 'declined' } },
  };

  function booking(overrides: Record<string, unknown> = {}) {
    return {
      id: 23278000,
      uuid: 'booking-uuid',
      trust_id: 'trust-id',
      status: 'unpaid',
      firstname: 'Payable',
      surname: 'Integration',
      email: 'buyer@example.invalid',
      date: '2035-06-15',
      total: 70000,
      total_unpaid: 70000,
      currencies: 'EUR',
      countries: 'PT',
      transaction_ids: [],
      channels: 2452,
      ...overrides,
    };
  }

  it('confirms an unsettled attempt against the booking and reports failed', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(booking()));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const context = { checkoutSessionId: '23278000' };

    expect(provider.verifyCallback(failurePayload, context)).toBe(true);
    await expect(provider.handleRedirectCallback(failurePayload, context)).resolves.toEqual({
      providerPaymentId: '23278000',
      checkoutSessionId: '23278000',
      status: 'failed',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/bookings/23278000',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects an unsigned failure payload that carries no checkout context', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(failurePayload)).toBe(false);
    await expect(provider.handleRedirectCallback(failurePayload)).rejects.toMatchObject({
      code: 'PROVIDER_TMT_INVALID_CALLBACK',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to report failed when the booking already carries transactions', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(booking({ transaction_ids: [25233460] })));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED' });
  });

  it('refuses to report failed when the booking is already partly paid', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(booking({ total_unpaid: 1000 })));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED' });
  });

  it('refuses a booking outside the configured channel', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(booking({ channels: 9999 })));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_TRANSACTION_SCOPE_MISMATCH' });
  });

  it.each([
    ['a modal timeout', { name: 'TimeoutError', message: 'timed out', booking_id: 23278000 }],
    ['a relayed empty error', {}],
    ['an envelope without a code', { message: 'boom', data: { status: 500 } }],
    ['an envelope with a success status', { code: 'ok', message: 'fine', data: { status: 200 } }],
    ['a signed callback shape', { id: 77, status: 'failed', total: 9999, hash: 'invalid' }],
  ])('does not treat %s as a confirmable failure', async (_label, payload) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(payload, { checkoutSessionId: '23278000' })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
