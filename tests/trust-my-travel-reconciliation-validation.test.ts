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

describe('Trust My Travel reconciliation validation', () => {
  it('rejects a successful response without a provider status instead of inventing state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 77,
          total: 9999,
          currencies: 'EUR',
          channels: 2452,
          bookings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.reconcilePaymentRecurring({ providerPaymentId: '77' }),
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
});
