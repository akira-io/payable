import type { Knex } from 'knex';

const TABLE = 'payable_customer_provider_sync_states';

export async function addCustomerProviderSyncStateLeases(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  const hasAttemptOwner = await knex.schema.hasColumn(TABLE, 'attempt_owner_id');
  const hasLeaseExpiry = await knex.schema.hasColumn(TABLE, 'lease_expires_at');
  if (hasAttemptOwner && hasLeaseExpiry) {
    return;
  }
  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasAttemptOwner) {
      table.uuid('attempt_owner_id').nullable();
    }
    if (!hasLeaseExpiry) {
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
    }
  });
}
