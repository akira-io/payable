import { describe, expect, it } from 'vitest';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import { IdempotencyConflictError } from '../src/domain/errors/idempotency-conflict.error';
import { IdempotencyInProgressError } from '../src/domain/errors/idempotency-in-progress.error';
import { FakeClock } from '../src/support/clock/fake-clock';
import { hashRequest } from '../src/support/hash/request-hash';
import { InMemoryIdempotencyStore } from './support/fakes';

const execution = (key: string, request: unknown, run: () => Promise<unknown>) => ({
  key,
  scope: 'charge',
  operation: 'charge',
  request,
  run,
});

describe('IdempotencyService', () => {
  it('runs the operation once and caches the response', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    let runs = 0;
    const request = { amount: 9900, currency: 'USD' };
    const run = async () => {
      runs += 1;
      return { paymentId: 'pay_1' };
    };

    const first = await service.execute(execution('charge:1', request, run));
    const second = await service.execute(execution('charge:1', request, run));

    expect(first).toEqual({ paymentId: 'pay_1' });
    expect(second).toEqual({ paymentId: 'pay_1' });
    expect(runs).toBe(1);
  });

  it('applies the revive hook on replay only, not on the first run', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    const request = { id: 'sub_1' };
    const run = async (): Promise<{ id: string; revived?: boolean }> => ({ id: 'sub_1' });
    const revive = (response: unknown) => ({ ...(response as { id: string }), revived: true });

    const first = await service.execute({
      key: 'sub:revive',
      scope: 'subscription',
      operation: 'create',
      request,
      run,
      revive,
    });
    const second = await service.execute({
      key: 'sub:revive',
      scope: 'subscription',
      operation: 'create',
      request,
      run,
      revive,
    });

    expect(first).not.toHaveProperty('revived');
    expect(second).toMatchObject({ id: 'sub_1', revived: true });
  });

  it('sets an expiry on the completed record', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const service = new IdempotencyService(store, clock, { completedTtlMs: 60_000 });

    await service.execute(execution('ttl', { amount: 100 }, async () => 'ok'));

    const record = await store.find('charge:ttl');
    expect(record?.status).toBe('completed');
    expect(record?.expiresAt?.toISOString()).toBe('2026-06-22T00:01:00.000Z');
  });

  it('honors a per-operation lockTtlMs over the service default', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const service = new IdempotencyService(store, clock, { lockTtlMs: 30_000 });
    let lockedUntilDuringRun: Date | null = null;

    await service.execute({
      ...execution('lockttl', { amount: 100 }, async () => {
        lockedUntilDuringRun = (await store.find('charge:lockttl'))?.lockedUntil ?? null;
        return 'ok';
      }),
      lockTtlMs: 120_000,
    });

    expect(lockedUntilDuringRun).not.toBeNull();
    expect((lockedUntilDuringRun as unknown as Date).toISOString()).toBe(
      '2026-06-22T00:02:00.000Z',
    );
  });

  it('isolates the same key across different scopes', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    const request = { amount: 100 };
    let chargeRuns = 0;
    let refundRuns = 0;

    await service.execute({
      key: 'shared',
      scope: 'charge',
      operation: 'charge',
      request,
      run: async () => {
        chargeRuns += 1;
        return 'charged';
      },
    });
    const refund = await service.execute({
      key: 'shared',
      scope: 'refund',
      operation: 'refund',
      request,
      run: async () => {
        refundRuns += 1;
        return 'refunded';
      },
    });

    expect(refund).toBe('refunded');
    expect(chargeRuns).toBe(1);
    expect(refundRuns).toBe(1);
  });

  it('throws on a reused key with a different request', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    await service.execute(execution('charge:2', { amount: 100 }, async () => 'ok'));
    await expect(
      service.execute(execution('charge:2', { amount: 200 }, async () => 'ok')),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('does not let an expired record bypass the request-hash check', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock();
    await store.put({
      key: 'charge:expired',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest({ amount: 100 }),
      response: null,
      status: 'expired',
      lockedUntil: null,
      expiresAt: null,
    });
    const service = new IdempotencyService(store, clock);
    await expect(
      service.execute(execution('expired', { amount: 999 }, async () => 'ok')),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('throws while another run holds the lock', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock();
    const request = { amount: 100 };
    await store.put({
      key: 'charge:3',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest(request),
      response: null,
      status: 'processing',
      lockedUntil: new Date(clock.now().getTime() + 30_000),
      expiresAt: null,
    });
    const service = new IdempotencyService(store, clock);
    await expect(service.execute(execution('3', request, async () => 'ok'))).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    );
  });

  it('marks failures and allows a retry', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    let attempts = 0;
    const request = { amount: 100 };
    const run = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('provider down');
      }
      return 'recovered';
    };

    await expect(service.execute(execution('charge:4', request, run))).rejects.toThrow(
      'provider down',
    );
    expect(await service.execute(execution('charge:4', request, run))).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('surfaces the operation error even when the failure cleanup write rejects', async () => {
    class FailingCleanupStore extends InMemoryIdempotencyStore {
      override markFailed(): Promise<void> {
        return Promise.reject(new Error('store unavailable'));
      }
    }
    const service = new IdempotencyService(new FailingCleanupStore(), new FakeClock());

    await expect(
      service.execute(
        execution('charge:cleanup', { amount: 1 }, async () => {
          throw new Error('provider declined');
        }),
      ),
    ).rejects.toThrow('provider declined');
  });

  it('re-runs a record whose expiresAt has passed', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock();
    await store.put({
      key: 'charge:exp',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest({ amount: 1 }),
      response: 'old',
      status: 'completed',
      lockedUntil: null,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    const result = await service.execute(
      execution('exp', { amount: 1 }, async () => {
        runs += 1;
        return 'new';
      }),
    );
    expect(result).toBe('new');
    expect(runs).toBe(1);
  });

  it('does not let a stale lock holder clobber the record (fencing token)', async () => {
    const store = new InMemoryIdempotencyStore();
    const base = {
      key: 'charge:fence',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest({ amount: 100 }),
      response: null,
      status: 'processing' as const,
      lockedUntil: null,
      expiresAt: null,
    };
    await store.acquire({ ...base, lockToken: 'owner-a' });
    await store.takeOver({ ...base, lockToken: 'owner-b' });

    await store.markCompleted('charge:fence', { from: 'a' }, null, 'owner-a');
    expect((await store.find('charge:fence'))?.status).toBe('processing');

    await store.markCompleted('charge:fence', { from: 'b' }, null, 'owner-b');
    const record = await store.find('charge:fence');
    expect(record?.status).toBe('completed');
    expect(record?.response).toEqual({ from: 'b' });
  });

  it('refuses to re-run a stale processing record whose side effect may have committed', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock();
    const request = { amount: 100 };
    await store.put({
      key: 'charge:stale',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest(request),
      response: null,
      status: 'processing',
      lockedUntil: new Date(clock.now().getTime() - 1_000),
      expiresAt: null,
      lockToken: 'owner-a',
    });
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    await expect(
      service.execute(
        execution('stale', request, async () => {
          runs += 1;
          return 'ok';
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
    expect(runs).toBe(0);
  });

  it('reclaims a stale processing record when reclaimStaleProcessing is set', async () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FakeClock();
    const request = { amount: 100 };
    await store.put({
      key: 'charge:reclaim',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: await hashRequest(request),
      response: null,
      status: 'processing',
      lockedUntil: new Date(clock.now().getTime() - 1_000),
      expiresAt: null,
      lockToken: 'owner-a',
    });
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    const result = await service.execute({
      ...execution('reclaim', request, async () => {
        runs += 1;
        return 'recovered';
      }),
      reclaimStaleProcessing: true,
    });
    expect(result).toBe('recovered');
    expect(runs).toBe(1);
  });

  it('refuses to retry a failed record when retryFailed is overridden to false', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    let attempts = 0;
    const request = { amount: 100 };
    const run = async () => {
      attempts += 1;
      throw new Error('provider down');
    };

    await expect(
      service.execute({ ...execution('charge:5', request, run), retryFailed: false }),
    ).rejects.toThrow('provider down');
    await expect(
      service.execute({ ...execution('charge:5', request, run), retryFailed: false }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(attempts).toBe(1);
  });

  it('lets a retryFailed:false record retry once its failure ttl elapses', async () => {
    const clock = new FakeClock();
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), clock, {
      failedTtlMs: 1_000,
    });
    let attempts = 0;
    const request = { amount: 100 };
    const run = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('provider down');
      }
      return 'recovered';
    };

    await expect(
      service.execute({ ...execution('charge:ttl', request, run), retryFailed: false }),
    ).rejects.toThrow('provider down');
    await expect(
      service.execute({ ...execution('charge:ttl', request, run), retryFailed: false }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    clock.advance(1_500);

    expect(
      await service.execute({ ...execution('charge:ttl', request, run), retryFailed: false }),
    ).toBe('recovered');
    expect(attempts).toBe(2);
  });
});
