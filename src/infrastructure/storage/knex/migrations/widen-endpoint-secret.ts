import type { Knex } from 'knex';

export async function widenEndpointSecret(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('payable_webhook_endpoints', 'secret'))) {
    return;
  }
  await knex.schema.alterTable('payable_webhook_endpoints', (table) => {
    table.text('secret').nullable().alter();
  });
}
