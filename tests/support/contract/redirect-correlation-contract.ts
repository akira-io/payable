import { expect, it } from 'vitest';
import type {
  NewRedirectCorrelation,
  RedirectCorrelationKey,
  RedirectCorrelationRepository,
} from '../../../src/domain/contracts/redirect-correlation-repository.contract';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

const KEY: RedirectCorrelationKey = {
  provider: 'sisp',
  merchantRef: 'R-1',
  merchantSession: 'S-1',
};

const ORPHAN_QUERY = { provider: 'sisp', tenantId: null, limit: 10 };

function newCorrelation(overrides: Partial<NewRedirectCorrelation> = {}): NewRedirectCorrelation {
  return {
    ...KEY,
    tenantId: null,
    amount: '1500.00',
    currency: '132',
    transactionCode: '1',
    recordedAt: CONTRACT_BASE_TIME,
    ...overrides,
  };
}

function repository(ctx: ContractContext): RedirectCorrelationRepository {
  const { redirectCorrelations } = ctx.harness().storage;
  if (!redirectCorrelations) {
    throw new Error('the storage driver does not expose redirectCorrelations');
  }
  return redirectCorrelations;
}

export function registerRedirectCorrelationContract(ctx: ContractContext): void {
  it('claims a recorded correlation once and reports the expected payment', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());

    const claim = await correlations.claim(KEY, CONTRACT_BASE_TIME);

    expect(claim).toEqual({
      status: 'claimed',
      expected: { amount: '1500.00', currency: '132', transactionCode: '1' },
    });
  });

  it('reports a replayed callback as already claimed', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, CONTRACT_BASE_TIME);

    expect(await correlations.claim(KEY, CONTRACT_BASE_TIME)).toEqual({
      status: 'already_claimed',
    });
  });

  it('hands the claim to exactly one of several concurrent deliveries', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());

    const claims = await Promise.all(
      Array.from({ length: 5 }, () => correlations.claim(KEY, CONTRACT_BASE_TIME)),
    );

    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'already_claimed')).toHaveLength(4);
  });

  it('distinguishes an unknown pair from a claimed one', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());

    expect(
      await correlations.claim({ ...KEY, merchantSession: 'S-other' }, CONTRACT_BASE_TIME),
    ).toEqual({ status: 'missing' });
  });

  it('keys correlations by the merchant session so a retry is its own row', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.record(newCorrelation({ merchantSession: 'S-2', amount: '20.00' }));

    const first = await correlations.claim(KEY, CONTRACT_BASE_TIME);
    const second = await correlations.claim({ ...KEY, merchantSession: 'S-2' }, CONTRACT_BASE_TIME);

    expect(first).toMatchObject({ status: 'claimed', expected: { amount: '1500.00' } });
    expect(second).toMatchObject({ status: 'claimed', expected: { amount: '20.00' } });
  });

  it('lists every session recorded against one merchant reference', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.record(newCorrelation({ merchantSession: 'S-2' }));
    await correlations.record(newCorrelation({ merchantRef: 'R-other', merchantSession: 'S-3' }));

    const sessions = await correlations.findSessionsByReference('sisp', 'R-1');

    expect([...sessions].sort()).toEqual(['S-1', 'S-2']);
  });

  it('ignores a duplicate record for the same merchant reference and session', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.record(newCorrelation({ amount: '9999.00' }));

    expect(await correlations.claim(KEY, CONTRACT_BASE_TIME)).toMatchObject({
      expected: { amount: '1500.00' },
    });
  });

  it('marks only the session whose outcome arrived', async () => {
    const correlations = repository(ctx);
    const claimedAt = new Date(CONTRACT_BASE_TIME.getTime() - 60_000);
    await correlations.record(newCorrelation());
    await correlations.record(newCorrelation({ merchantSession: 'S-2' }));
    await correlations.claim(KEY, claimedAt);
    await correlations.claim({ ...KEY, merchantSession: 'S-2' }, claimedAt);

    await correlations.markProcessed(KEY, {
      verified: true,
      status: 'completed',
      reason: null,
      processedAt: CONTRACT_BASE_TIME,
    });

    const orphaned = await correlations.findOrphanedClaims({
      ...ORPHAN_QUERY,
      claimedBefore: CONTRACT_BASE_TIME,
    });
    expect(orphaned.map((claim) => claim.merchantSession)).toEqual(['S-2']);
  });

  it('records the whole outcome, not only that one arrived', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, CONTRACT_BASE_TIME);
    await correlations.markProcessed(KEY, {
      verified: false,
      status: 'failed',
      reason: 'callback_replayed',
      processedAt: CONTRACT_BASE_TIME,
    });

    await correlations.record(newCorrelation({ merchantSession: 'S-2' }));
    await correlations.claim({ ...KEY, merchantSession: 'S-2' }, CONTRACT_BASE_TIME);
    const [stored] = await correlations.findOrphanedClaims({
      ...ORPHAN_QUERY,
      claimedBefore: new Date(CONTRACT_BASE_TIME.getTime() + 1),
    });

    expect(stored?.merchantSession).toBe('S-2');
    expect(stored?.outcomeVerified).toBeNull();
  });

  it('lists a claim that was never processed and drops it once the outcome lands', async () => {
    const correlations = repository(ctx);
    const claimedAt = new Date(CONTRACT_BASE_TIME.getTime() - 60_000);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, claimedAt);

    const query = { ...ORPHAN_QUERY, claimedBefore: CONTRACT_BASE_TIME };
    const orphaned = await correlations.findOrphanedClaims(query);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({ merchantRef: 'R-1', processedAt: null });

    await correlations.markProcessed(KEY, {
      verified: true,
      status: 'completed',
      reason: null,
      processedAt: CONTRACT_BASE_TIME,
    });

    expect(await correlations.findOrphanedClaims(query)).toEqual([]);
  });

  it('treats the cutoff as exclusive on both sides', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, CONTRACT_BASE_TIME);

    const atTheCutoff = await correlations.findOrphanedClaims({
      ...ORPHAN_QUERY,
      claimedBefore: CONTRACT_BASE_TIME,
    });
    const justAfter = await correlations.findOrphanedClaims({
      ...ORPHAN_QUERY,
      claimedBefore: new Date(CONTRACT_BASE_TIME.getTime() + 1),
    });

    expect(atTheCutoff).toEqual([]);
    expect(justAfter).toHaveLength(1);
  });

  it('leaves an unclaimed correlation out of the orphan list', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());

    expect(
      await correlations.findOrphanedClaims({
        ...ORPHAN_QUERY,
        claimedBefore: new Date(CONTRACT_BASE_TIME.getTime() + 60_000),
      }),
    ).toEqual([]);
  });

  it('returns the oldest claims first and honours the limit', async () => {
    const correlations = repository(ctx);
    for (const [index, session] of ['S-1', 'S-2', 'S-3'].entries()) {
      await correlations.record(newCorrelation({ merchantSession: session }));
      await correlations.claim(
        { ...KEY, merchantSession: session },
        new Date(CONTRACT_BASE_TIME.getTime() - (3 - index) * 60_000),
      );
    }

    const page = await correlations.findOrphanedClaims({
      ...ORPHAN_QUERY,
      claimedBefore: CONTRACT_BASE_TIME,
      limit: 2,
    });

    expect(page.map((claim) => claim.merchantSession)).toEqual(['S-1', 'S-2']);
  });

  it('scopes the orphan list to one tenant', async () => {
    const correlations = repository(ctx);
    const claimedAt = new Date(CONTRACT_BASE_TIME.getTime() - 60_000);
    await correlations.record(newCorrelation({ tenantId: 'tenant-a' }));
    await correlations.record(
      newCorrelation({ tenantId: 'tenant-b', merchantRef: 'R-2', merchantSession: 'S-2' }),
    );
    await correlations.claim(KEY, claimedAt);
    await correlations.claim(
      { provider: 'sisp', merchantRef: 'R-2', merchantSession: 'S-2' },
      claimedAt,
    );

    const forTenantA = await correlations.findOrphanedClaims({
      provider: 'sisp',
      tenantId: 'tenant-a',
      claimedBefore: CONTRACT_BASE_TIME,
      limit: 10,
    });

    expect(forTenantA.map((claim) => claim.merchantRef)).toEqual(['R-1']);
  });
}
