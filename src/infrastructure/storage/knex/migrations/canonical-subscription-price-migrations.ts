import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

const TABLE = 'payable_subscription_price_migrations';
const CLAIM_TABLE = 'payable_subscription_mutation_claims';
const TERMINAL_STATUSES = ['applied', 'cancelled'] as const;

export async function addCanonicalSubscriptionPriceMigrations(knex: Knex): Promise<void> {
  await ensureTenantIdentity(
    knex,
    'payable_subscriptions',
    'payable_subscriptions_tenant_id_unique',
    ['tenant_key', 'id'],
  );
  await ensureTenantIdentity(
    knex,
    'payable_subscription_provider_bindings',
    'payable_subscription_bindings_tenant_id_unique',
    ['tenant_key', 'id'],
  );
  await createIfMissing(knex, TABLE, (table) => {
    table.uuid('id').primary();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('subscription_id').notNullable();
    table.uuid('primary_item_id').notNullable();
    table.uuid('active_subscription_id').nullable();
    table.uuid('source_price_id').notNullable();
    table.uuid('target_price_id').notNullable();
    table.text('source_price').notNullable();
    table.text('target_price').notNullable();
    table.text('current_items').notNullable();
    table.text('proposed_items').notNullable();
    table.string('effective_timing').notNullable();
    table.timestamp('effective_at', { useTz: true }).nullable();
    table.string('proration_policy').notNullable();
    table.string('payment_failure_policy').notNullable();
    table.text('immediate_adjustment').notNullable();
    table.text('next_renewal').notNullable();
    table.timestamp('current_renewal_date', { useTz: true }).nullable();
    table.text('warnings').notNullable();
    table.text('provider_limitations').notNullable();
    table.text('provider_evidence').nullable();
    table.string('preview_token').notNullable();
    table.string('request_hash').notNullable();
    table.timestamp('calculated_at', { useTz: true }).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.uuid('provider_binding_id').notNullable();
    table.string('status').notNullable();
    table.integer('attempt_count').notNullable();
    table.string('execution_token').nullable();
    table.string('failure_code').nullable();
    table.text('failure_message').nullable();
    table.timestamp('scheduled_at', { useTz: true }).nullable();
    table.timestamp('execution_started_at', { useTz: true }).nullable();
    table.timestamp('applied_at', { useTz: true }).nullable();
    table.timestamp('failed_at', { useTz: true }).nullable();
    table.timestamp('reconciliation_required_at', { useTz: true }).nullable();
    table.string('reconciliation_outcome').nullable();
    table.text('reconciliation_evidence_reference').nullable();
    table.timestamp('reconciliation_resolved_at', { useTz: true }).nullable();
    table.text('reconciliation_observation_evidence_reference').nullable();
    table.timestamp('reconciliation_observed_at', { useTz: true }).nullable();
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'subscription_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_subscriptions')
      .onDelete('RESTRICT');
    table
      .foreign(['tenant_key', 'source_price_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_prices')
      .onDelete('RESTRICT');
    table
      .foreign(['tenant_key', 'target_price_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_prices')
      .onDelete('RESTRICT');
    table
      .foreign(['tenant_key', 'provider_binding_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_subscription_provider_bindings')
      .onDelete('RESTRICT');
    table.unique(['tenant_key', 'id'], {
      indexName: 'payable_subscription_price_migrations_tenant_id_unique',
    });
    table.unique(['tenant_key', 'active_subscription_id'], {
      indexName: 'payable_subscription_price_migrations_active_unique',
    });
    table.index(
      ['tenant_key', 'status', 'created_at', 'id'],
      'payable_subscription_price_migrations_tenant_status_page_index',
    );
    table.index(
      ['tenant_key', 'subscription_id', 'created_at', 'id'],
      'payable_subscription_price_migrations_subscription_page_index',
    );
    table.index(
      ['tenant_key', 'status', 'effective_at', 'id'],
      'payable_subscription_price_migrations_due_index',
    );
    table.check(
      "(effective_timing = 'scheduled' AND effective_at IS NOT NULL) OR (effective_timing IN ('immediate', 'nextRenewal') AND effective_at IS NULL)",
      {},
      'payable_subscription_price_migrations_effective_timing_check',
    );
    table.check(
      `((status IN (${TERMINAL_STATUSES.map((status) => `'${status}'`).join(', ')}) OR (status = 'failed' AND COALESCE(reconciliation_outcome, '') = 'not_applied')) AND active_subscription_id IS NULL) OR (status NOT IN (${TERMINAL_STATUSES.map((status) => `'${status}'`).join(', ')}) AND NOT (status = 'failed' AND COALESCE(reconciliation_outcome, '') = 'not_applied') AND active_subscription_id = subscription_id)`,
      {},
      'payable_subscription_price_migrations_active_key_check',
    );
    table.check(
      "(status IN ('executing', 'pending_renewal', 'applied', 'reconciliation_required') AND execution_token IS NOT NULL) OR (status IN ('previewed', 'scheduled', 'failed', 'cancelled') AND execution_token IS NULL)",
      {},
      'payable_subscription_price_migrations_ownership_check',
    );
    table.check('attempt_count >= 0', {}, 'payable_subscription_price_migrations_attempt_check');
    table.check(
      "(reconciliation_outcome IS NULL AND reconciliation_evidence_reference IS NULL AND reconciliation_resolved_at IS NULL) OR (reconciliation_outcome IN ('applied', 'not_applied') AND reconciliation_evidence_reference IS NOT NULL AND reconciliation_resolved_at IS NOT NULL)",
      {},
      'payable_subscription_price_migrations_resolution_check',
    );
    table.check(
      '(reconciliation_observation_evidence_reference IS NULL AND reconciliation_observed_at IS NULL) OR (reconciliation_observation_evidence_reference IS NOT NULL AND reconciliation_observed_at IS NOT NULL)',
      {},
      'payable_subscription_price_migrations_observation_check',
    );
  });
  await createIfMissing(knex, CLAIM_TABLE, (table) => {
    table.string('claim_reference').primary();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('subscription_id').notNullable();
    table.uuid('active_subscription_id').nullable();
    table.string('owner_token').notNullable();
    table.string('operation').notNullable();
    table.string('correlation_id').notNullable();
    table.text('intent').nullable();
    table.string('status').notNullable();
    table.string('resolution_outcome').nullable();
    table.text('resolution_evidence_reference').nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.string('observation_outcome').nullable();
    table.text('observation_evidence_reference').nullable();
    table.timestamp('observed_at', { useTz: true }).nullable();
    table.timestamp('claimed_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'subscription_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_subscriptions')
      .onDelete('RESTRICT');
    table.unique(['owner_token'], {
      indexName: 'payable_subscription_mutation_claims_owner_unique',
    });
    table.unique(['tenant_key', 'active_subscription_id'], {
      indexName: 'payable_subscription_mutation_claims_active_unique',
    });
    table.check(
      "(status = 'active' AND active_subscription_id = subscription_id AND resolution_outcome IS NULL AND resolution_evidence_reference IS NULL AND resolved_at IS NULL) OR (status = 'resolved' AND active_subscription_id IS NULL AND resolution_outcome IN ('applied', 'not_applied') AND resolution_evidence_reference IS NOT NULL AND resolved_at IS NOT NULL)",
      {},
      'payable_subscription_mutation_claims_state_check',
    );
    table.check(
      "(observation_outcome IS NULL AND observation_evidence_reference IS NULL AND observed_at IS NULL) OR (observation_outcome = 'unknown' AND observation_evidence_reference IS NOT NULL AND observed_at IS NOT NULL)",
      {},
      'payable_subscription_mutation_claims_observation_check',
    );
  });
}

async function ensureTenantIdentity(
  knex: Knex,
  table: string,
  index: string,
  columns: string[],
): Promise<void> {
  if (!(await knex.schema.hasTable(table)) || (await indexExists(knex, table, index))) return;
  const placeholders = columns.map(() => '??').join(', ');
  await knex.raw(`CREATE UNIQUE INDEX ?? ON ?? (${placeholders})`, [index, table, ...columns]);
}

async function indexExists(knex: Knex, table: string, index: string): Promise<boolean> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    return Boolean(await knex('sqlite_master').where({ type: 'index', name: index }).first());
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = ANY(current_schemas(false)) AND tablename = ? AND indexname = ?) AS present',
      [table, index],
    )) as { rows?: { present?: boolean }[] };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [table, index],
    )) as [{ count?: number | string }[], unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for migration index introspection: ${dialect}`);
}
