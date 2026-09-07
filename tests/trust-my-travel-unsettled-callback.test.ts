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

  it.each([
    ['a payment required', 'transaction_declined', 402],
    ['a malformed request', 'rest_invalid_param', 400],
    ['an expired account token', 'auth_invalid', 401],
    ['a forbidden channel', 'auth_invalid', 403],
    ['an unknown route', 'rest_no_route', 404],
    ['a conflicting booking state', 'rest_conflict', 409],
    ['an unprocessable transaction body', 'rest_invalid_param', 422],
    ['a rate limit', 'too_many_requests', 429],
    ['an internal provider error', 'rest_upstream', 500],
    ['a bad gateway', 'rest_upstream', 502],
    ['an unavailable provider', 'rest_upstream', 503],
    ['a gateway timeout', 'rest_upstream', 504],
    ['an unnamed upstream status', 'rest_upstream', 599],
  ])('verifies but never confirms a failure from %s', async (_label, code, status) => {
    const warn = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch, logger });
    const payload = { code, message: 'the attempt never reached the acquirer', data: { status } };
    const context = { checkoutSessionId: '23278000' };

    expect(provider.verifyCallback(payload, context)).toBe(true);
    await expect(provider.handleRedirectCallback(payload, context)).rejects.toMatchObject({
      code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED',
      context: expect.objectContaining({
        provider: 'trust-my-travel',
        bookingId: 23278000,
        providerCode: code,
        providerStatus: status,
      }),
    });
    expect(warn).toHaveBeenCalledWith(
      'Trust My Travel did not report a decision on the payment attempt',
      expect.objectContaining({
        provider: 'trust-my-travel',
        providerCode: code,
        providerStatus: status,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads no booking, so no booking state can confirm a failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.handleRedirectCallback(failurePayload, { checkoutSessionId: '23278000' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED' });
    expect(fetch).not.toHaveBeenCalled();
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

  it.each([
    ['a modal timeout', { name: 'TimeoutError', message: 'timed out', booking_id: 23278000 }],
    ['a relayed empty error', {}],
    ['an envelope without a code', { message: 'boom', data: { status: 500 } }],
    ['an envelope with a success status', { code: 'ok', message: 'fine', data: { status: 200 } }],
    ['a signed callback shape', { id: 77, status: 'failed', total: 9999, hash: 'invalid' }],
  ])('does not treat %s as a recognised envelope', async (_label, payload) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(payload, { checkoutSessionId: '23278000' })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['data is missing', { code: 'x', message: 'y' }],
    ['data is not an object', { code: 'x', message: 'y', data: 402 }],
    ['data is an array', { code: 'x', message: 'y', data: [402] }],
    ['data.status is a string', { code: 'x', message: 'y', data: { status: '402' } }],
    ['message is not a string', { code: 'x', message: 7, data: { status: 402 } }],
    [
      'code is longer than the provider allows',
      { code: 'x'.repeat(192), message: 'y', data: { status: 402 } },
    ],
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

  it('rejects an empty context the same way as a missing one', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(provider.verifyCallback(failurePayload, {})).toBe(false);
    await expect(provider.handleRedirectCallback(failurePayload, {})).rejects.toMatchObject({
      code: 'PROVIDER_TMT_INVALID_CALLBACK',
    });
    expect(fetch).not.toHaveBeenCalled();
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
});
