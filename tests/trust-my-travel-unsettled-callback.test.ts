import { createHash } from 'node:crypto';
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
    const result = await provider.handleRedirectCallback(failurePayload, context);
    expect(result).toMatchObject({
      providerPaymentId: '23278000',
      checkoutSessionId: '23278000',
      status: 'failed',
    });
    expect(result.amount?.amount()).toBe(70000);
    expect(result.amount?.currency()).toBe('EUR');
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
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_SCOPE_MISMATCH' });
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

  it.each([
    ['a gateway timeout', { status: 504 }],
    ['an internal provider error', { status: 500 }],
  ])('refuses to confirm a failure from %s', async (_label, data) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(
        { code: 'rest_upstream', message: 'upstream failed', data },
        { checkoutSessionId: '23278000' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['transaction_ids is absent', { transaction_ids: undefined }],
    ['transaction_ids is null', { transaction_ids: null }],
    ['total_unpaid is absent', { total_unpaid: undefined }],
  ])('refuses to confirm a failure when %s', async (_label, overrides) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(booking(overrides)));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED' });
  });

  it('still reconciles a signed callback that arrives with a checkout session', async () => {
    const transaction = {
      id: 25233460,
      status: 'complete',
      total: 70000,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 23278000, currencies: 'EUR', total: 70000 }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(transaction));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const first = createHash('sha256').update('25233460&complete&70000').digest('hex');
    const hash = createHash('sha256').update(`${first}${OPTIONS.channelSecret}`).digest('hex');
    const context = { checkoutSessionId: '23278000' };
    const payload = { id: 25233460, status: 'complete', total: 70000, hash };

    expect(provider.verifyCallback(payload, context)).toBe(true);
    await expect(provider.handleRedirectCallback(payload, context)).resolves.toMatchObject({
      providerPaymentId: '25233460',
      status: 'succeeded',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/transactions/25233460',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects an empty context the same way as a missing one', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(failurePayload, {})).toBe(false);
    await expect(provider.handleRedirectCallback(failurePayload, {})).rejects.toMatchObject({
      code: 'PROVIDER_TMT_INVALID_CALLBACK',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a booking whose currency is outside the configured channel', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(booking({ currencies: 'GBP' })));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_BOOKING_SCOPE_MISMATCH' });
  });

  it('warns with the provider code when it confirms an unsettled attempt', async () => {
    const warn = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(booking()));
    const provider = new TrustMyTravelProvider({
      ...OPTIONS,
      fetch,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });

    await provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' });

    expect(warn).toHaveBeenCalledWith(
      'Trust My Travel reported an unsettled payment attempt',
      expect.objectContaining({ bookingId: 23278000, providerCode: 'transaction_declined' }),
    );
  });

  it.each([
    ['data is missing', { code: 'x', message: 'y' }],
    ['data is not an object', { code: 'x', message: 'y', data: 402 }],
    ['data is an array', { code: 'x', message: 'y', data: [402] }],
    ['data.status is a string', { code: 'x', message: 'y', data: { status: '402' } }],
    ['message is not a string', { code: 'x', message: 7, data: { status: 402 } }],
  ])('does not recognise an envelope where %s', async (_label, payload) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(payload, { checkoutSessionId: '23278000' })).toBe(false);
    await expect(
      provider.handleRedirectCallback(payload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_INVALID_CALLBACK' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '0',
    '-1',
    '44.0',
    ' 44 ',
    '0x10',
    '1e7',
    'booking-44',
  ])('refuses %j as a checkout session', async (checkoutSessionId) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(failurePayload, { checkoutSessionId })).toBe(false);
    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_INVALID_CALLBACK' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
