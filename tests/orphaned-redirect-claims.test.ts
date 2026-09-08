import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const NOW = new Date('2026-06-22T12:00:00.000Z');

async function payableWithStorage() {
  const db = createTestDb();
  await migrate(db);
  const storage = new KnexStorageDriver(db, new FakeClock(NOW));
  const payable = createPayable({
    providers: { fake: new FakeProvider() },
    storage,
    clock: new FakeClock(NOW),
  });
  return { db, storage, payable };
}

async function recordClaim(
  storage: KnexStorageDriver,
  merchantSession: string,
  claimedAt: Date | null,
): Promise<void> {
  const correlations = storage.redirectCorrelations;
  await correlations.record({
    provider: 'sisp',
    merchantRef: 'R-1',
    merchantSession,
    tenantId: null,
    amount: '1500.00',
    currency: '132',
    transactionCode: '1',
    recordedAt: NOW,
  });
  if (claimedAt) {
    await correlations.claim({ provider: 'sisp', merchantRef: 'R-1', merchantSession }, claimedAt);
  }
}

describe('orphaned redirect claims', () => {
  it('lists only claims older than the cutoff that never recorded an outcome', async () => {
    const { db, storage, payable } = await payableWithStorage();
    await recordClaim(storage, 'S-stale', new Date(NOW.getTime() - 30 * 60_000));
    await recordClaim(storage, 'S-fresh', new Date(NOW.getTime() - 60_000));
    await recordClaim(storage, 'S-unclaimed', null);

    const orphaned = await payable
      .orphanedRedirectClaims()
      .run({ provider: 'sisp', olderThanMinutes: 15 });

    expect(orphaned.map((claim) => claim.merchantSession)).toEqual(['S-stale']);
    await db.destroy();
  });

  it('drops a claim from the list once its outcome is recorded', async () => {
    const { db, storage, payable } = await payableWithStorage();
    const claimedAt = new Date(NOW.getTime() - 30 * 60_000);
    await recordClaim(storage, 'S-stale', claimedAt);
    await storage.redirectCorrelations.markProcessed(
      { provider: 'sisp', merchantRef: 'R-1', merchantSession: 'S-stale' },
      { verified: true, status: 'completed', reason: null, processedAt: NOW },
    );

    await expect(
      payable.orphanedRedirectClaims().run({ provider: 'sisp', olderThanMinutes: 15 }),
    ).resolves.toEqual([]);
    await db.destroy();
  });

  it('refuses to run without a storage driver that tracks correlations', async () => {
    const payable = createPayable({ providers: { fake: new FakeProvider() } });

    expect(() => payable.orphanedRedirectClaims().run({ provider: 'sisp' })).toThrow(
      expect.objectContaining({ code: 'REDIRECT_CORRELATION_STORAGE_REQUIRED' }),
    );
  });
});
