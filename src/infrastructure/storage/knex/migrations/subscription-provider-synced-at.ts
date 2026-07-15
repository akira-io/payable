import type { Knex } from 'knex';

export async function addSubscriptionProviderSyncedAt(knex: Knex): Promise<void> {
  const table = 'payable_subscriptions';
  if (
    !(await knex.schema.hasTable(table)) ||
    (await knex.schema.hasColumn(table, 'provider_synced_at'))
  ) {
    return;
  }
  await knex.schema.alterTable(table, (builder) => {
    builder.timestamp('provider_synced_at', { useTz: true }).nullable();
  });
}
