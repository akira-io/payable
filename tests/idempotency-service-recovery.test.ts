import { describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import type { IdempotencyRecord } from '../src/domain/contracts/idempotency-store.contract';
import { Money } from '../src/domain/value-objects/money';
import { FakeClock } from '../src/support/clock/fake-clock';
import { hashRequest } from '../src/support/hash/request-hash';
import { InMemoryIdempotencyStore } from './support/fakes';

const NOW = new Date('2026-06-22T00:00:00.000Z');
const COMPLETED_TTL_MS = 86_400_000;

function createIdempotencyRecord(
  overrides: Partial<IdempotencyRecord> & Pick<IdempotencyRecord, 'requestHash'>,
): IdempotencyRecord {
  return {
    key: 'catalog.price.create:price-request',
    scope: 'catalog.price.create',
    operation: 'create',
    resourceType: 'price',
    resourceId: null,
    response: null,
    status: 'processing',
    lockedUntil: new Date(NOW.getTime() + COMPLETED_TTL_MS),
    expiresAt: null,
    lockToken: 'lock-token',
    ...overrides,
  };
}

function revivePrice(response: unknown): { unitAmount: Money } {
  if (!response || typeof response !== 'object' || !('unitAmount' in response)) {
    throw new TypeError('Invalid price response');
  }
  const unitAmount = response.unitAmount;
  if (
    !unitAmount ||
    typeof unitAmount !== 'object' ||
    !('amount' in unitAmount) ||
    !('currency' in unitAmount) ||
    typeof unitAmount.amount !== 'number' ||
    typeof unitAmount.currency !== 'string'
  ) {
    throw new TypeError('Invalid price amount');
  }
  return { unitAmount: Money.of(unitAmount.amount, unitAmount.currency) };
}

function execution<T>(run: () => Promise<T>) {
  return {
    key: 'price-request',
    scope: 'catalog.price.create',
    operation: 'create',
    request: { providerProductId: 'prod_1', unitAmount: 9900 },
    failurePolicy: 'reconciliation-required' as const,
    correlationId: 'corr-catalog-1',
    run,
  };
}

describe('IdempotencyService recovery', () => {
  it('revives a completed response found after losing the acquisition race', async () => {
    const store = new InMemoryIdempotencyStore();
    const request = { providerProductId: 'prod_1', unitAmount: 9900 };
    const completedRecord = createIdempotencyRecord({
      requestHash: await hashRequest(request),
      response: { unitAmount: { amount: 9900, currency: 'USD' } },
      status: 'completed',
      lockedUntil: null,
      expiresAt: new Date(NOW.getTime() + COMPLETED_TTL_MS),
    });
    const find = vi
      .spyOn(store, 'find')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedRecord);
    const acquire = vi.spyOn(store, 'acquire').mockResolvedValue(false);
    const run = vi.fn(async () => ({ unitAmount: Money.of(9900, 'USD') }));

    const price = await new IdempotencyService(store, new FakeClock(NOW)).execute({
      ...execution(run),
      request,
      revive: revivePrice,
    });

    expect(price.unitAmount).toBeInstanceOf(Money);
    expect(price.unitAmount.amount()).toBe(9900);
    expect(find).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('uses the completed TTL for reconciliation locks and failed records', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock(NOW);
    const service = new IdempotencyService(store, clock, { completedTtlMs: COMPLETED_TTL_MS });
    const acquire = vi.spyOn(store, 'acquire');
    const markFailed = vi.spyOn(store, 'markFailed');
    const run = vi.fn(async () => {
      throw new Error('provider result unknown');
    });
    const idempotentExecution = execution(run);

    await expect(service.execute(idempotentExecution)).rejects.toThrow('provider result unknown');

    const acquired = acquire.mock.calls[0]?.[0];
    const failedRecord = await store.find('catalog.price.create:price-request');
    expect(acquired?.lockedUntil?.toISOString()).toBe('2026-06-23T00:00:00.000Z');
    expect(failedRecord?.expiresAt?.toISOString()).toBe('2026-06-23T00:00:00.000Z');
    expect(markFailed).toHaveBeenCalledTimes(1);
    await expect(service.execute(idempotentExecution)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns the verified completed response when the completion write throws', async () => {
    const store = new InMemoryIdempotencyStore();
    const persistCompletion = store.markCompleted.bind(store);
    const markCompleted = vi.spyOn(store, 'markCompleted');
    markCompleted.mockImplementation(async (key, _response, tenantId, lockToken, expiresAt) => {
      await persistCompletion(
        key,
        { unitAmount: { amount: 9900, currency: 'USD' } },
        tenantId,
        lockToken,
        expiresAt,
      );
      throw new Error('connection lost after commit');
    });
    const markFailed = vi.spyOn(store, 'markFailed');
    const run = vi.fn(async () => ({ unitAmount: Money.of(9900, 'USD') }));

    const price = await new IdempotencyService(store, new FakeClock(NOW)).execute({
      ...execution(run),
      revive: revivePrice,
    });

    expect(price.unitAmount).toBeInstanceOf(Money);
    expect(price.unitAmount.currency()).toBe('USD');
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects when completion silently leaves the record processing', async () => {
    const store = new InMemoryIdempotencyStore();
    const markCompleted = vi.spyOn(store, 'markCompleted').mockResolvedValue(undefined);
    const markFailed = vi.spyOn(store, 'markFailed');
    const run = vi.fn(async () => ({ priceId: 'price_1' }));

    await expect(
      new IdempotencyService(store, new FakeClock(NOW)).execute(execution(run)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED' });

    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('preserves correlation when completion and its verification both fail', async () => {
    const store = new InMemoryIdempotencyStore();
    const verificationFailure = new Error('verification unavailable');
    const find = vi
      .spyOn(store, 'find')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(verificationFailure);
    const completionFailure = new Error('completion unavailable');
    const markCompleted = vi.spyOn(store, 'markCompleted').mockRejectedValue(completionFailure);
    const markFailed = vi.spyOn(store, 'markFailed');
    const run = vi.fn(async () => ({ priceId: 'price_1' }));

    await expect(
      new IdempotencyService(store, new FakeClock(NOW)).execute(execution(run)),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
      correlationId: 'corr-catalog-1',
      cause: completionFailure,
    });

    expect(find).toHaveBeenCalledTimes(2);
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
