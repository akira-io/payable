import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { payableSispCorrelationStore } from '../src/infrastructure/providers/sisp/sisp-correlation-store';
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
  tenantId: string | null = null,
): Promise<void> {
  const correlations = storage.redirectCorrelations;
  await correlations.record({
    provider: 'sisp',
    merchantRef: 'R-1',
    merchantSession,
    tenantId,
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

  it('scopes the list to one tenant', async () => {
    const { db, storage, payable } = await payableWithStorage();
    const claimedAt = new Date(NOW.getTime() - 30 * 60_000);
    await recordClaim(storage, 'S-a', claimedAt, 'tenant-a');
    await recordClaim(storage, 'S-b', claimedAt, 'tenant-b');

    const forTenantA = await payable
      .orphanedRedirectClaims()
      .run({ provider: 'sisp', tenantId: 'tenant-a', olderThanMinutes: 15 });

    expect(forTenantA.map((claim) => claim.merchantSession)).toEqual(['S-a']);
    await db.destroy();
  });

  it('rejects a query that would scan the future or return nothing', async () => {
    const { db, payable } = await payableWithStorage();

    expect(() =>
      payable.orphanedRedirectClaims().run({ provider: 'sisp', olderThanMinutes: -1 }),
    ).toThrow(expect.objectContaining({ code: 'REDIRECT_CORRELATION_QUERY_INVALID' }));
    expect(() => payable.orphanedRedirectClaims().run({ provider: 'sisp', limit: 0 })).toThrow(
      expect.objectContaining({ code: 'REDIRECT_CORRELATION_QUERY_INVALID' }),
    );
    await db.destroy();
  });

  it('refuses to build a SISP correlation store on a driver without the repository', () => {
    expect(() => payableSispCorrelationStore({})).toThrow(
      expect.objectContaining({ code: 'PROVIDER_SISP_CORRELATION_STORAGE_MISSING' }),
    );
  });

  it('refuses to run without a storage driver that tracks correlations', async () => {
    const payable = createPayable({ providers: { fake: new FakeProvider() } });

    expect(() => payable.orphanedRedirectClaims().run({ provider: 'sisp' })).toThrow(
      expect.objectContaining({ code: 'REDIRECT_CORRELATION_STORAGE_REQUIRED' }),
    );
  });
});
