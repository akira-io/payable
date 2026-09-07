import type { Knex } from 'knex';
import { indexExists } from './provider-neutral-page-indexes';

const PAYMENT_TABLE = 'payable_payments';
const INDEX = 'payable_payments_tenant_status_page_index';

export async function addPaymentStatusPageIndex(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(PAYMENT_TABLE))) return;
  if (await indexExists(knex, PAYMENT_TABLE, INDEX)) return;
  try {
    await knex.raw('CREATE INDEX ?? ON ?? (??, ??, ??, ??)', [
      INDEX,
      PAYMENT_TABLE,
      'tenant_key',
      'status',
      'created_at',
      'id',
    ]);
  } catch (error) {
    if (!(await indexExists(knex, PAYMENT_TABLE, INDEX))) {
      throw error;
    }
  }
}
