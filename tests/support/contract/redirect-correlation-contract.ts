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

  it('ignores a duplicate record for the same merchant reference and session', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.record(newCorrelation({ amount: '9999.00' }));

    expect(await correlations.claim(KEY, CONTRACT_BASE_TIME)).toMatchObject({
      expected: { amount: '1500.00' },
    });
  });

  it('lists a claim that was never processed and drops it once the outcome lands', async () => {
    const correlations = repository(ctx);
    const claimedAt = new Date(CONTRACT_BASE_TIME.getTime() - 60_000);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, claimedAt);

    const query = { provider: 'sisp', claimedBefore: CONTRACT_BASE_TIME, limit: 10 };
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

  it('leaves a claim that is younger than the cutoff out of the orphan list', async () => {
    const correlations = repository(ctx);
    await correlations.record(newCorrelation());
    await correlations.claim(KEY, CONTRACT_BASE_TIME);

    expect(
      await correlations.findOrphanedClaims({
        provider: 'sisp',
        claimedBefore: new Date(CONTRACT_BASE_TIME.getTime() - 1),
        limit: 10,
      }),
    ).toEqual([]);
  });
}
