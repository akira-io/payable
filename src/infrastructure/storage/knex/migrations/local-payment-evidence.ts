import type { Knex } from 'knex';

const EVIDENCE_COLUMNS = [
  'collection_method',
  'occurred_at',
  'external_reference',
  'recorded_by',
] as const;

export async function addLocalPaymentEvidence(knex: Knex): Promise<void> {
  for (const table of ['payable_payments', 'payable_refunds']) {
    if (!(await knex.schema.hasTable(table))) {
      continue;
    }
    for (const column of EVIDENCE_COLUMNS) {
      if (!(await knex.schema.hasColumn(table, column))) {
        await knex.schema.alterTable(table, (builder) => {
          if (column === 'occurred_at') builder.timestamp(column, { useTz: true }).nullable();
          else builder.string(column).nullable();
        });
      }
    }
    await knex.schema.alterTable(table, (builder) => {
      builder.string('provider').nullable().alter();
    });
  }
  if (
    (await knex.schema.hasTable('payable_payments')) &&
    !(await paymentTenantIdentityExists(knex))
  ) {
    await knex.schema.alterTable('payable_payments', (table) => {
      table.unique(['tenant_key', 'id'], {
        indexName: 'payable_payments_tenant_id_unique',
      });
    });
  }
}

async function paymentTenantIdentityExists(knex: Knex): Promise<boolean> {
  const name = 'payable_payments_tenant_id_unique';
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    return Boolean(await knex('sqlite_master').where({ type: 'index', name }).first());
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = ANY(current_schemas(false)) AND tablename = ? AND indexname = ?) AS present',
      ['payable_payments', name],
    )) as { rows?: { present?: boolean }[] };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      ['payable_payments', name],
    )) as [{ count?: number | string }[], unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for index introspection: ${dialect}`);
}
