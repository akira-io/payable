import { knex as createKnex, type Knex } from 'knex';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RedirectCorrelationKey } from '../src/domain/contracts/redirect-correlation-repository.contract';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexRedirectCorrelationRepository } from '../src/infrastructure/storage/knex/repositories/knex-redirect-correlation.repository';

const CONNECTION = process.env.PAYABLE_TEST_POSTGRES_URL;
const CONCURRENT_DELIVERIES = 16;
const KEY: RedirectCorrelationKey = {
  provider: 'sisp',
  merchantRef: 'R-concurrent',
  merchantSession: 'S-concurrent',
};

let db: Knex;

describe.skipIf(!CONNECTION)('redirect correlation claims on postgres', () => {
  beforeEach(async () => {
    db ??= createKnex({ client: 'pg', connection: CONNECTION, pool: { min: 2, max: 16 } });
    await migrate(db);
    await db('payable_redirect_correlations').where({ provider: KEY.provider }).delete();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('hands the claim to exactly one of many concurrent callback deliveries', async () => {
    const correlations = new KnexRedirectCorrelationRepository(db);
    const now = new Date();
    await correlations.record({
      ...KEY,
      tenantId: null,
      amount: '1500.00',
      currency: '132',
      transactionCode: '1',
      recordedAt: now,
    });

    const claims = await Promise.all(
      Array.from({ length: CONCURRENT_DELIVERIES }, () => correlations.claim(KEY, new Date())),
    );

    const statuses = claims.map((claim) => claim.status);
    expect(statuses.filter((status) => status === 'claimed')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'already_claimed')).toHaveLength(
      CONCURRENT_DELIVERIES - 1,
    );
    expect(statuses).not.toContain('missing');
  });
});
