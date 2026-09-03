import type { Knex } from 'knex';

export async function addPaymentAuthorizationLifecycle(knex: Knex): Promise<void> {
  const table = 'payable_payments';
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, 'captured_amount'))) {
    await knex.schema.alterTable(table, (builder) => {
      builder.bigInteger('captured_amount').notNullable().defaultTo(0);
    });
  }
  for (const column of ['authorized_at', 'authorization_expires_at']) {
    if (!(await knex.schema.hasColumn(table, column))) {
      await knex.schema.alterTable(table, (builder) => {
        builder.timestamp(column, { useTz: true }).nullable();
      });
    }
  }
}
