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

function callbackHash(id: number, status: string, total: number): string {
  const first = createHash('sha256').update(`${id}&${status}&${total}`).digest('hex');
  return createHash('sha256').update(`${first}${OPTIONS.channelSecret}`).digest('hex');
}

describe('Trust My Travel callback reconciliation', () => {
  it('verifies the callback locally then reconciles from the provider transaction', async () => {
    const transaction = {
      id: 77,
      status: 'complete',
      total: 9999,
      total_remaining: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(transaction));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 77,
      status: 'complete',
      total: 9999,
      hash: callbackHash(77, 'complete', 9999),
    };

    expect(await provider.verifyCallback(payload)).toBe(true);
    const result = await provider.handleRedirectCallback(payload);
    expect(result).toMatchObject({
      providerPaymentId: '77',
      checkoutSessionId: '44',
      status: 'succeeded',
    });
    expect(result.amount?.amount()).toBe(9999);
    expect(result.amount?.currency()).toBe('EUR');
    expect(fetch).toHaveBeenCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/transactions/77',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('falls back to the booking id when a purchase reports a null linked_id', async () => {
    const transaction = {
      id: 25223767,
      status: 'complete',
      total: 1000,
      currencies: 'EUR',
      channels: 2452,
      transaction_types: 'purchase',
      linked_id: null,
      bookings: [{ id: 23268341, currencies: 'EUR', total: 1000 }],
      card_types: 'visa',
      last_four_digits: '1111',
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(transaction));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 25223767,
      status: 'complete',
      total: 1000,
      hash: callbackHash(25223767, 'complete', 1000),
    };

    const result = await provider.handleRedirectCallback(payload);
    expect(result).toMatchObject({
      providerPaymentId: '25223767',
      checkoutSessionId: '23268341',
      status: 'succeeded',
    });
    expect(result.checkoutSessionId).not.toBe('null');
  });

  it('prefers the linked authorization over the booking id on a capture', async () => {
    const transaction = {
      id: 88,
      status: 'complete',
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      transaction_types: 'capture',
      linked_id: 77,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(transaction));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 88,
      status: 'complete',
      total: 9999,
      hash: callbackHash(88, 'complete', 9999),
    };

    await expect(provider.handleRedirectCallback(payload)).resolves.toMatchObject({
      providerPaymentId: '88',
      checkoutSessionId: '77',
      status: 'succeeded',
    });
  });

  it('ignores linked_id on an authorization and reports the booking id', async () => {
    const transaction = {
      id: 77,
      status: 'complete',
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      transaction_types: 'authorize',
      linked_id: 55,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(transaction));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 77,
      status: 'complete',
      total: 9999,
      hash: callbackHash(77, 'complete', 9999),
    };

    await expect(provider.handleRedirectCallback(payload)).resolves.toMatchObject({
      checkoutSessionId: '44',
      status: 'authorized',
    });
  });

  it('rejects an invalid callback hash before calling the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = { id: 77, status: 'complete', total: 9999, hash: 'invalid' };

    expect(await provider.verifyCallback(payload)).toBe(false);
    await expect(provider.handleRedirectCallback(payload)).rejects.toMatchObject({
      code: 'PROVIDER_TMT_INVALID_CALLBACK',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves transaction_result_available from its id-only payload through the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 77,
        status: 'pending',
        total: 9999,
        currencies: 'EUR',
        channels: 2452,
        bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(await provider.verifyCallback({ id: 77 })).toBe(true);
    await expect(provider.handleRedirectCallback({ id: 77 })).resolves.toMatchObject({
      providerPaymentId: '77',
      checkoutSessionId: '44',
      status: 'processing',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['failed', 'failed'],
    ['pending', 'processing'],
    ['expired', 'failed'],
  ] as const)('maps %s transactions to %s', async (providerStatus, expectedStatus) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 77,
        status: providerStatus,
        total: 9999,
        currencies: 'EUR',
        channels: 2452,
        bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 77,
      status: providerStatus,
      total: 9999,
      hash: callbackHash(77, providerStatus, 9999),
    };

    await expect(provider.handleRedirectCallback(payload)).resolves.toMatchObject({
      status: expectedStatus,
    });
  });

  it.each([
    ['locked', 'PROVIDER_TRANSACTION_LOCKED'],
    ['incomplete', 'PROVIDER_RESULT_UNKNOWN'],
  ] as const)('rejects the non-canonical %s status', async (providerStatus, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 77,
        status: providerStatus,
        total: 9999,
        currencies: 'EUR',
        channels: 2452,
        bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const payload = {
      id: 77,
      status: providerStatus,
      total: 9999,
      hash: callbackHash(77, providerStatus, 9999),
    };

    await expect(provider.handleRedirectCallback(payload)).rejects.toMatchObject({ code });
  });
});
