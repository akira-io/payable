import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';

describe('Trust My Travel refund allocations', () => {
  it('rejects duplicate booking ids before posting a multi-booking refund', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 77,
          status: 'complete',
          total: 10_000,
          total_remaining: 10_000,
          currencies: 'EUR',
          channels: 2452,
          bookings: [
            { id: 44, currencies: 'EUR', total: 5000 },
            { id: 45, currencies: 'EUR', total: 5000 },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new TrustMyTravelProvider({
      path: 'merchant',
      apiToken: 'api-token',
      channelId: 2452,
      channelSecret: 'channel-secret',
      currency: 'EUR',
      environment: 'test',
      baseUrl: 'https://tmt.test',
      fetch,
    });

    await expect(
      provider.refund(
        {
          providerPaymentId: '77',
          amount: Money.of(5000, 'EUR'),
          providerData: {
            bookings: [
              { id: 44, currencies: 'EUR', total: 2500 },
              { id: 44, currencies: 'EUR', total: 2500 },
            ],
          },
        },
        { correlationId: 'corr-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_REFUND_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
