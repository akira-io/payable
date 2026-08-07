import type { Knex } from 'knex';

const COLUMNS = [
  'scheduled_change_action',
  'scheduled_change_effective_at',
  'scheduled_resume_at',
  'resume_billing_policy',
  'payment_collection_pause_behavior',
  'payment_collection_resumes_at',
] as const;

export async function addSubscriptionLifecycleMetadata(knex: Knex): Promise<void> {
  const table = 'payable_subscriptions';
  if (!(await knex.schema.hasTable(table))) {
    return;
  }
  const missing = new Set<string>();
  for (const column of COLUMNS) {
    if (!(await knex.schema.hasColumn(table, column))) {
      missing.add(column);
    }
  }
  if (missing.size === 0) {
    return;
  }
  await knex.schema.alterTable(table, (builder) => {
    if (missing.has('scheduled_change_action'))
      builder.string('scheduled_change_action').nullable();
    if (missing.has('scheduled_change_effective_at'))
      builder.timestamp('scheduled_change_effective_at', { useTz: true }).nullable();
    if (missing.has('scheduled_resume_at'))
      builder.timestamp('scheduled_resume_at', { useTz: true }).nullable();
    if (missing.has('resume_billing_policy')) builder.string('resume_billing_policy').nullable();
    if (missing.has('payment_collection_pause_behavior'))
      builder.string('payment_collection_pause_behavior').nullable();
    if (missing.has('payment_collection_resumes_at'))
      builder.timestamp('payment_collection_resumes_at', { useTz: true }).nullable();
  });
}
