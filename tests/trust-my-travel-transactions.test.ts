import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
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

describe('Trust My Travel transactions', () => {
  it('captures with linked_id and provider-neutral allocations', async () => {
    const original = {
      id: 77,
      status: 'complete',
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      transaction_types: 'authorize',
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(original))
      .mockResolvedValueOnce(
        jsonResponse({ ...original, id: 88, transaction_types: 'capture', linked_id: 77 }),
      );
    const result = await new TrustMyTravelProvider({ ...OPTIONS, fetch }).capture(
      {
        providerPaymentId: '77',
        amount: Money.of(9999, 'EUR'),
        allocations: [{ reference: '44', amount: Money.of(9999, 'EUR') }],
      },
      { correlationId: 'corr-1', idempotencyKey: 'capture-1' },
    );
    expect(result.status).toBe('succeeded');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      channels: 2452,
      currencies: 'EUR',
      total: 9999,
      transaction_types: 'capture',
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      linked_id: 77,
    });
  });

  it('voids an authorization with linked_id and no allocations', async () => {
    const original = {
      id: 77,
      status: 'complete',
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      transaction_types: 'authorize',
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(original))
      .mockResolvedValueOnce(
        jsonResponse({ ...original, id: 89, transaction_types: 'void', linked_id: 77 }),
      );
    const result = await new TrustMyTravelProvider({ ...OPTIONS, fetch }).void(
      { providerPaymentId: '77' },
      { correlationId: 'corr-1', idempotencyKey: 'void-1' },
    );
    expect(result.status).toBe('canceled');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      channels: 2452,
      currencies: 'EUR',
      total: 9999,
      transaction_types: 'void',
      bookings: original.bookings,
      linked_id: 77,
    });
  });

  it('reads the original transaction before creating a bounded refund', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 77,
          status: 'complete',
          total: 9999,
          total_remaining: 6999,
          currencies: 'EUR',
          channels: 2452,
          bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 88,
          status: 'complete',
          total: 3000,
          currencies: 'EUR',
          channels: 2452,
          bookings: [{ id: 44, currencies: 'EUR', total: 3000 }],
          transaction_types: 'refund',
          linked_id: 77,
        }),
      );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const result = await provider.refund(
      { providerPaymentId: '77', amount: Money.of(3000, 'EUR') },
      { correlationId: 'corr-1', idempotencyKey: 'refund-1' },
    );
    expect(result).toMatchObject({ providerRefundId: '88', status: 'succeeded' });
    expect(result.amount.amount()).toBe(3000);
    expect(result.amount.currency()).toBe('EUR');
    const [, createCall] = fetch.mock.calls;
    expect(createCall?.[0]).toBe('https://tmt.test/merchant/wp-json/tmt/v2/transactions');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      channels: 2452,
      currencies: 'EUR',
      total: 3000,
      transaction_types: 'refund',
      bookings: [{ id: 44, currencies: 'EUR', total: 3000 }],
      linked_id: 77,
    });
  });

  it('refunds the full remaining amount when no amount is supplied', async () => {
    const transaction = {
      id: 77,
      status: 'complete',
      total: 9999,
      total_remaining: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(transaction))
      .mockResolvedValueOnce(jsonResponse({ ...transaction, id: 88 }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const result = await provider.refund({ providerPaymentId: '77' }, { correlationId: 'corr-1' });

    expect(result.amount.amount()).toBe(9999);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      total: 9999,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    });
  });

  it('rejects a refund currency mismatch without posting', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 77,
        status: 'complete',
        total: 9999,
        total_remaining: 9999,
        currencies: 'EUR',
        channels: 2452,
        bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.refund(
        { providerPaymentId: '77', amount: Money.of(1000, 'USD') },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_REFUND_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns provider truth when a refund response differs from the request', async () => {
    const original = {
      id: 77,
      status: 'complete',
      total: 9999,
      total_remaining: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(original))
      .mockResolvedValueOnce(jsonResponse({ ...original, id: 88, total: 2999 }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const result = await provider.refund(
      { providerPaymentId: '77', amount: Money.of(3000, 'EUR') },
      { correlationId: 'corr-1' },
    );

    expect(result.providerRefundId).toBe('88');
    expect(result.amount.amount()).toBe(2999);
    expect(result.amount.currency()).toBe('EUR');
  });

  it('rejects a refund above the provider remaining amount without posting', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        id: 77,
        status: 'complete',
        total: 9999,
        total_remaining: 2000,
        currencies: 'EUR',
        channels: 2452,
        bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      }),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.refund(
        { providerPaymentId: '77', amount: Money.of(3000, 'EUR') },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_REFUND_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
