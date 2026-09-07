import { describe, expect, it, vi } from 'vitest';
import { FakeClock, TrustMyTravelProvider } from '../src';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const OPTIONS = {
  path: 'merchant',
  apiToken: '',
  channelId: 2452,
  channelSecret: '',
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
};

function response(extra: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      id: 77,
      status: 'locked',
      total: 9999,
      currencies: 'EUR',
      channels: 2452,
      bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('Trust My Travel chargeback projection', () => {
  it('projects changing chargeback fields from the private API while keeping locked non-terminal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        chargeback_status: 'challenged',
        outcome_status: 'awaiting_review',
        reason_code: '10.4',
        challenge_date: '2030-01-01',
      }),
    );
    const instance = new TrustMyTravelProvider({
      ...OPTIONS,
      clock: new FakeClock(NOW),
      fetch,
    });

    await expect(
      instance.reconcilePaymentRecurring({
        providerPaymentId: '77',
        providerData: { bookingId: 44 },
      }),
    ).resolves.toMatchObject({
      outcome: 'retry',
      providerStatus: 'locked',
      status: 'pending',
      providerData: {
        chargebackStatus: 'challenged',
        outcomeStatus: 'awaiting_review',
        reasonCode: '10.4',
        challengeDate: '2030-01-01',
      },
    });
  });
  it('omits chargeback fields the private API returns as null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        chargeback_status: null,
        outcome_status: null,
        reason_code: '10.4',
        challenge_date: null,
      }),
    );
    const instance = new TrustMyTravelProvider({
      ...OPTIONS,
      clock: new FakeClock(NOW),
      fetch,
    });

    const result = await instance.reconcilePaymentRecurring({
      providerPaymentId: '77',
      providerData: { bookingId: 44 },
    });
    expect(result.providerData).toEqual({ reasonCode: '10.4' });
  });
  it('reports no provider data when every chargeback field is null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        chargeback_status: null,
        outcome_status: null,
        reason_code: null,
        challenge_date: null,
      }),
    );
    const instance = new TrustMyTravelProvider({
      ...OPTIONS,
      clock: new FakeClock(NOW),
      fetch,
    });

    const result = await instance.reconcilePaymentRecurring({
      providerPaymentId: '77',
      providerData: { bookingId: 44 },
    });
    expect(result.providerData).toBeUndefined();
  });
});
