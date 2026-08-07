import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('subscription lifecycle metadata migration', () => {
  it('adds nullable lifecycle fields idempotently', async () => {
    await migrate(db);
    await migrate(db);

    const columns = await db('payable_subscriptions').columnInfo();
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'scheduled_change_action',
        'scheduled_change_effective_at',
        'scheduled_resume_at',
        'resume_billing_policy',
        'payment_collection_pause_behavior',
        'payment_collection_resumes_at',
      ]),
    );
    for (const name of [
      'scheduled_change_action',
      'scheduled_change_effective_at',
      'scheduled_resume_at',
      'resume_billing_policy',
      'payment_collection_pause_behavior',
      'payment_collection_resumes_at',
    ]) {
      expect(columns[name]?.nullable, name).toBe(true);
    }
  });
});
