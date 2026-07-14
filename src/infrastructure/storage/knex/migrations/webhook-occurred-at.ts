import type { Knex } from 'knex';

export async function addWebhookOccurredAt(knex: Knex): Promise<void> {
  const table = 'payable_webhook_events';
  if (!(await knex.schema.hasTable(table)) || (await knex.schema.hasColumn(table, 'occurred_at'))) {
    return;
  }
  await knex.schema.alterTable(table, (builder) => {
    builder.timestamp('occurred_at', { useTz: true }).nullable();
  });
}
