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

  it('throws on a reused key with a different request', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    await service.execute(execution('charge:2', { amount: 100 }, async () => 'ok'));
    await expect(
      service.execute(execution('charge:2', { amount: 200 }, async () => 'ok')),
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
    await expect(
      service.execute(execution('charge:3', request, async () => 'ok')),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
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
});
