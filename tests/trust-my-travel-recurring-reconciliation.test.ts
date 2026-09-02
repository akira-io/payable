import { describe, expect, it, vi } from 'vitest';
import {
  createPayable,
  FakeClock,
  isRecurringPaymentReconciliationCapable,
  type RecurringPaymentReconciliationCursor,
  TrustMyTravelProvider,
} from '../src';

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

function transaction(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 77,
    status,
    total: 9999,
    currencies: 'EUR',
    channels: 2452,
    bookings: [{ id: 44, currencies: 'EUR', total: 9999 }],
    ...extra,
  };
}

function response(status: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify(transaction(status, extra)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(
  statuses: string[],
  reconciliation = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 4_000 },
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const status of statuses) fetch.mockResolvedValueOnce(response(status));
  const instance = new TrustMyTravelProvider({
    ...OPTIONS,
    clock: new FakeClock(NOW),
    fetch,
    reconciliation,
  });
  return { instance, fetch };
}

describe('Trust My Travel recurring reconciliation', () => {
  it.each([
    ['complete', 'succeeded'],
    ['failed', 'failed'],
    ['expired', 'failed'],
  ] as const)('returns confirmed %s as a terminal result', async (providerStatus, status) => {
    const { instance } = provider([providerStatus]);

    expect(isRecurringPaymentReconciliationCapable(instance)).toBe(true);
    await expect(instance.reconcilePaymentRecurring({ providerPaymentId: '77' })).resolves.toEqual({
      outcome: 'terminal',
      providerPaymentId: '77',
      providerStatus,
      status,
      attempt: 1,
    });
  });

  it('is discoverable through the provider-neutral registry capability', () => {
    const { instance } = provider([]);
    const registered = createPayable({ providers: { travel: instance } })
      .providers()
      .get('travel');

    expect(isRecurringPaymentReconciliationCapable(registered)).toBe(true);
  });

  it.each([
    ['pending', 'processing'],
    ['incomplete', 'pending'],
    ['locked', 'pending'],
  ] as const)('keeps %s non-terminal without inventing an outcome', async (providerStatus, status) => {
    const { instance } = provider([providerStatus]);

    const result = await instance.reconcilePaymentRecurring({ providerPaymentId: '77' });

    expect(result).toEqual({
      outcome: 'retry',
      providerPaymentId: '77',
      providerStatus,
      status,
      attempt: 1,
      cursor: {
        providerPaymentId: '77',
        attempt: 1,
        nextAttemptAt: '2030-01-02T03:04:06.000Z',
        lastProviderStatus: providerStatus,
        lastStatus: status,
      },
    });
  });

  it('resumes from a JSON-round-tripped cursor and caps exponential backoff', async () => {
    const { instance } = provider(['pending'], {
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 4_000,
    });
    const cursor = JSON.parse(
      JSON.stringify({
        providerPaymentId: '77',
        attempt: 3,
        nextAttemptAt: '2030-01-02T03:04:04.000Z',
        lastProviderStatus: 'pending',
        lastStatus: 'processing',
      } satisfies RecurringPaymentReconciliationCursor),
    ) as RecurringPaymentReconciliationCursor;

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77', cursor }),
    ).resolves.toMatchObject({
      outcome: 'retry',
      attempt: 4,
      cursor: { attempt: 4, nextAttemptAt: '2030-01-02T03:04:09.000Z' },
    });
  });

  it('stops honestly at the hard attempt limit while preserving the last observation', async () => {
    const { instance } = provider(['locked'], {
      maxAttempts: 4,
      baseDelayMs: 1_000,
      maxDelayMs: 4_000,
    });
    const cursor: RecurringPaymentReconciliationCursor = {
      providerPaymentId: '77',
      attempt: 3,
      nextAttemptAt: '2030-01-02T03:04:04.000Z',
      lastProviderStatus: 'pending',
      lastStatus: 'processing',
    };

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77', cursor }),
    ).resolves.toEqual({
      outcome: 'exhausted',
      providerPaymentId: '77',
      providerStatus: 'locked',
      status: 'pending',
      attempt: 4,
      reason: 'attempt_limit',
    });
  });

  it('projects changing chargeback fields from the private API while keeping locked non-terminal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response('locked', {
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
      instance.reconcilePaymentRecurring({ providerPaymentId: '77' }),
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

  it('does not query before the persisted next-attempt time', async () => {
    const { instance, fetch } = provider([]);
    const cursor: RecurringPaymentReconciliationCursor = {
      providerPaymentId: '77',
      attempt: 1,
      nextAttemptAt: '2030-01-02T03:05:05.000Z',
      lastProviderStatus: 'pending',
      lastStatus: 'processing',
    };

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77', cursor }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_NOT_DUE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid retry policy options at construction', () => {
    expect(
      () =>
        new TrustMyTravelProvider({
          ...OPTIONS,
          reconciliation: { maxAttempts: 0, baseDelayMs: 1_000, maxDelayMs: 500 },
        }),
    ).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_TMT_RECONCILIATION_OPTIONS_INVALID' }),
    );
  });

  it('rejects an early or mismatched cursor without contacting TMT', async () => {
    const { instance, fetch } = provider([]);
    const cursor: RecurringPaymentReconciliationCursor = {
      providerPaymentId: 'other',
      attempt: 1,
      nextAttemptAt: '2030-01-02T03:05:05.000Z',
      lastProviderStatus: 'pending',
      lastStatus: 'processing',
    };

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77', cursor }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_CURSOR_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed rehydrated cursor without contacting TMT', async () => {
    const { instance, fetch } = provider([]);
    const cursor = {
      providerPaymentId: '77',
      attempt: 1,
      nextAttemptAt: '2030-01-02T03:04:04.000Z',
      lastProviderStatus: 42,
      lastStatus: 'invented',
    } as unknown as RecurringPaymentReconciliationCursor;

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77', cursor }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_CURSOR_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a transaction response for a different provider payment id', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(transaction('pending', { id: 78 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const instance = new TrustMyTravelProvider({
      ...OPTIONS,
      clock: new FakeClock(NOW),
      fetch,
    });

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_TRANSACTION_ID_MISMATCH' });
  });

  it('does not advance persisted state when TMT returns no response', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('network unavailable'));
    const instance = new TrustMyTravelProvider({
      ...OPTIONS,
      clock: new FakeClock(NOW),
      fetch,
      reconciliation: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 4_000 },
    });

    await expect(
      instance.reconcilePaymentRecurring({ providerPaymentId: '77' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('is stateless and returns the same transition for the same persisted input', async () => {
    const { instance } = provider(['pending', 'pending']);

    const first = await instance.reconcilePaymentRecurring({ providerPaymentId: '77' });
    const repeated = await instance.reconcilePaymentRecurring({ providerPaymentId: '77' });

    expect(repeated).toEqual(first);
  });
});
