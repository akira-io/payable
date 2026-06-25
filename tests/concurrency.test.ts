import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import type { IdempotencyRecord } from '../src/domain/contracts/idempotency-store.contract';
import { IdempotencyInProgressError } from '../src/domain/errors/idempotency-in-progress.error';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { KnexOutboxEventRepository } from '../src/infrastructure/storage/knex/repositories/knex-outbox-event.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { hashRequest } from '../src/support/hash/request-hash';
import { createTestDb } from './support/knex';

let db: Knex;
let clock: FakeClock;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
});

afterEach(async () => {
  await db.destroy();
});

const processing = (key: string): IdempotencyRecord => ({
  key,
  scope: 'charge',
  operation: 'charge',
  resourceType: null,
  resourceId: null,
  requestHash: 'hash',
  response: null,
  status: 'processing',
  lockedUntil: new Date(clock.now().getTime() + 30_000),
  expiresAt: null,
});

describe('idempotency lock acquisition (C2)', () => {
  it('lets only one acquirer win, even with a null tenant', async () => {
    const store = new KnexIdempotencyRepository(db, clock);
    expect(await store.acquire(processing('charge:1'))).toBe(true);
    expect(await store.acquire(processing('charge:1'))).toBe(false);
  });

  it('runs the operation exactly once under concurrent execution', async () => {
    const store = new KnexIdempotencyRepository(db, clock);
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    const execution = () => ({
      key: 'charge:2',
      scope: 'charge',
      operation: 'charge',
      request: { amount: 9900 },
      run: async () => {
        runs += 1;
        await Promise.resolve();
        return { paymentId: 'pay_1' };
      },
    });

    const settled = await Promise.allSettled([
      service.execute(execution()),
      service.execute(execution()),
    ]);

    expect(runs).toBe(1);
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it('fails closed on a stale processing lock instead of re-running', async () => {
    const store = new KnexIdempotencyRepository(db, clock);
    const requestHash = await hashRequest({ amount: 9900 });
    await store.acquire({
      ...processing('charge:3'),
      requestHash,
      lockedUntil: new Date(clock.now().getTime() - 1),
    });
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    const execution = () => ({
      key: 'charge:3',
      scope: 'charge',
      operation: 'charge',
      request: { amount: 9900 },
      run: async () => {
        runs += 1;
        await Promise.resolve();
        return { paymentId: 'pay_3' };
      },
    });

    const settled = await Promise.allSettled([
      service.execute(execution()),
      service.execute(execution()),
    ]);

    expect(runs).toBe(0);
    for (const result of settled) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(IdempotencyInProgressError);
      }
    }
  });

  it('reclaims a stale processing lock once when reclaimStaleProcessing is set', async () => {
    const store = new KnexIdempotencyRepository(db, clock);
    const requestHash = await hashRequest({ amount: 9900 });
    await store.acquire({
      ...processing('charge:4'),
      requestHash,
      lockedUntil: new Date(clock.now().getTime() - 1),
    });
    const service = new IdempotencyService(store, clock);
    let runs = 0;
    const execution = () => ({
      key: 'charge:4',
      scope: 'charge',
      operation: 'charge',
      request: { amount: 9900 },
      reclaimStaleProcessing: true,
      run: async () => {
        runs += 1;
        await Promise.resolve();
        return { paymentId: 'pay_4' };
      },
    });

    const settled = await Promise.allSettled([
      service.execute(execution()),
      service.execute(execution()),
    ]);

    expect(runs).toBe(1);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        expect(result.value).toEqual({ paymentId: 'pay_4' });
      } else {
        expect(result.reason).toBeInstanceOf(IdempotencyInProgressError);
      }
    }
  });
});

describe('outbox claim (C3)', () => {
  const newOutbox = () => ({
    tenantId: null,
    correlationId: 'corr-1',
    eventType: 'invoice.paid.v1',
    eventVersion: 1,
    payload: { ref: 'x' },
  });

  it('does not re-claim an already-claimed event', async () => {
    const repo = new KnexOutboxEventRepository(db, clock);
    await repo.create(newOutbox());

    const first = await repo.claimPending(10);
    const second = await repo.claimPending(10);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('recovers a stale claim after the lock TTL expires', async () => {
    const repo = new KnexOutboxEventRepository(db, clock);
    await repo.create(newOutbox());

    expect(await repo.claimPending(10)).toHaveLength(1);
    expect(await repo.claimPending(10)).toHaveLength(0);

    clock.advance(300_001);
    expect(await repo.claimPending(10)).toHaveLength(1);
  });

  it('claims each event at most once across concurrent claimers', async () => {
    const repo = new KnexOutboxEventRepository(db, clock);
    await repo.create(newOutbox());
    await repo.create(newOutbox());
    await repo.create(newOutbox());

    const [a, b] = await Promise.all([repo.claimPending(10), repo.claimPending(10)]);
    const ids = [...a, ...b].map((event) => event.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
