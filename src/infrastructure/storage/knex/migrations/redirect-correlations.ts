import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

const TABLE = 'payable_redirect_correlations';

export async function addRedirectCorrelations(knex: Knex): Promise<void> {
  await createIfMissing(knex, TABLE, (table) => {
    table.string('provider').notNullable();
    table.string('merchant_ref').notNullable();
    table.string('merchant_session').notNullable();
    table.string('tenant_id').nullable();
    table.string('amount').notNullable();
    table.string('currency').nullable();
    table.string('transaction_code').nullable();
    table.timestamp('recorded_at', { useTz: true }).notNullable();
    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.boolean('outcome_verified').nullable();
    table.string('outcome_status').nullable();
    table.string('outcome_reason').nullable();
    table.primary(['provider', 'merchant_ref', 'merchant_session']);
    table.index(
      ['provider', 'claimed_at', 'processed_at'],
      'payable_redirect_correlations_orphan_index',
    );
  });
}
