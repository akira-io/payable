import type { Knex } from 'knex';

const MIGRATIONS = 'payable_subscription_price_migrations';
const CLAIMS = 'payable_subscription_mutation_claims';
const INTENT_PREFIX = 'payable:subscription-mutation-intent:v1:';
const CLAIM_OBSERVATION_CONSTRAINT = 'payable_subscription_mutation_claims_observation_check';
const MIGRATION_OBSERVATION_CONSTRAINT = 'payable_subscription_price_migrations_observation_check';

export async function addSubscriptionMutationRecovery(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(CLAIMS)) {
    if (
      (await knex.schema.hasColumn(CLAIMS, 'projection')) &&
      !(await knex.schema.hasColumn(CLAIMS, 'intent'))
    ) {
      await knex.schema.alterTable(CLAIMS, (table) => table.renameColumn('projection', 'intent'));
    }
    await migrateLegacyIntents(knex);
    await addColumn(knex, CLAIMS, 'observation_outcome', (table) =>
      table.string('observation_outcome'),
    );
    await addColumn(knex, CLAIMS, 'observation_evidence_reference', (table) =>
      table.text('observation_evidence_reference'),
    );
    await addColumn(knex, CLAIMS, 'observed_at', (table) =>
      table.timestamp('observed_at', { useTz: true }),
    );
    await addCheckConstraint(
      knex,
      CLAIMS,
      CLAIM_OBSERVATION_CONSTRAINT,
      "(observation_outcome IS NULL AND observation_evidence_reference IS NULL AND observed_at IS NULL) OR (observation_outcome = 'unknown' AND observation_evidence_reference IS NOT NULL AND observed_at IS NOT NULL)",
    );
  }
  if (await knex.schema.hasTable(MIGRATIONS)) {
    await addColumn(knex, MIGRATIONS, 'reconciliation_observation_evidence_reference', (table) =>
      table.text('reconciliation_observation_evidence_reference'),
    );
    await addColumn(knex, MIGRATIONS, 'reconciliation_observed_at', (table) =>
      table.timestamp('reconciliation_observed_at', { useTz: true }),
    );
    await addCheckConstraint(
      knex,
      MIGRATIONS,
      MIGRATION_OBSERVATION_CONSTRAINT,
      '(reconciliation_observation_evidence_reference IS NULL AND reconciliation_observed_at IS NULL) OR (reconciliation_observation_evidence_reference IS NOT NULL AND reconciliation_observed_at IS NOT NULL)',
    );
  }
}

async function migrateLegacyIntents(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn(CLAIMS, 'intent'))) return;
  const rows = (await knex(CLAIMS)
    .whereNotNull('intent')
    .select('claim_reference', 'intent')) as Array<{
    claim_reference: string;
    intent: string;
  }>;
  for (const row of rows) {
    if (row.intent.startsWith(INTENT_PREFIX)) continue;
    await knex(CLAIMS)
      .where({ claim_reference: row.claim_reference, intent: row.intent })
      .update({ intent: `${INTENT_PREFIX}${row.intent}` });
  }
}

async function addCheckConstraint(
  knex: Knex,
  tableName: string,
  constraint: string,
  expression: string,
): Promise<void> {
  if (await hasConstraint(knex, tableName, constraint)) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.check(expression, {}, constraint);
  });
}

async function hasConstraint(knex: Knex, tableName: string, constraint: string): Promise<boolean> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    const row = (await knex('sqlite_master')
      .where({ type: 'table', name: tableName })
      .first('sql')) as { sql?: string } | undefined;
    return row?.sql?.includes(constraint) ?? false;
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ?) AS present',
      [constraint],
    )) as { rows?: Array<{ present?: boolean }> };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      'SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?',
      [tableName, constraint],
    )) as [Array<{ count?: number | string }>, unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for constraint introspection: ${dialect}`);
}

async function addColumn(
  knex: Knex,
  tableName: string,
  column: string,
  define: (table: Knex.AlterTableBuilder) => void,
): Promise<void> {
  if (await knex.schema.hasColumn(tableName, column)) return;
  await knex.schema.alterTable(tableName, define);
}
