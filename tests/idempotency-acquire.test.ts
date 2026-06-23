import { describe, expect, it } from 'vitest';
import type { IdempotencyRecord } from '../src/domain/contracts/idempotency-store.contract';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const record = (key: string): IdempotencyRecord => ({
  key,
  scope: 'charge',
  operation: 'charge',
  resourceType: null,
  resourceId: null,
  requestHash: 'hash',
  response: null,
  status: 'processing',
  lockedUntil: null,
  expiresAt: null,
  lockToken: 'owner',
});

describe('idempotency acquire', () => {
  it('returns true for the first acquirer and false on a duplicate key', async () => {
    const db = createTestDb();
    await migrate(db);
    const store = new KnexIdempotencyRepository(db, new FakeClock());

    expect(await store.acquire(record('charge:acq'))).toBe(true);
    expect(await store.acquire(record('charge:acq'))).toBe(false);
    await db.destroy();
  });
});
