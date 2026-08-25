import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('canonical migration crash recovery', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('resolves a retained executing owner after a crash before the provider call', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-pre-provider-crash',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    const token = 'retained-pre-provider-owner';
    await database('payable_subscription_price_migrations').where({ id: preview.id }).update({
      status: 'executing',
      execution_token: token,
      attempt_count: 1,
      execution_started_at: new Date().toISOString(),
    });
    await database('payable_subscription_mutation_claims').insert({
      claim_reference: `subscription-price-migration:${preview.id}:${token}`,
      tenant_key: TENANT,
      subscription_id: subscription.id,
      active_subscription_id: subscription.id,
      owner_token: token,
      operation: 'subscription_price_migration',
      correlation_id: 'pre-provider-crash-correlation',
      intent: null,
      status: 'active',
      claimed_at: new Date().toISOString(),
    });

    const observed = await resource.resolve(preview.id, {
      idempotencyKey: 'observe-pre-provider-crash',
      outcome: 'unknown',
      evidenceReference: 'host-crash-observation-1',
    });
    expect(observed).toMatchObject({
      status: 'reconciliation_required',
      executionToken: token,
      reconciliationObservationEvidenceReference: 'host-crash-observation-1',
      reconciliationObservedAt: expect.any(Date),
    });
    const audit = await database('payable_audit_logs')
      .where({ resource_id: preview.id })
      .orderBy('created_at', 'desc')
      .first();
    expect(JSON.parse(audit.after)).toMatchObject({
      reconciliationObservationOutcome: 'unknown',
      reconciliationObservationEvidenceReference: 'host-crash-observation-1',
      correlationId: audit.correlation_id,
    });
    expect(audit.correlation_id).toEqual(expect.any(String));
    const outbox = await database('payable_outbox_events')
      .where({ event_type: 'subscription.price_migration.reconciliation_required.v1' })
      .first();
    expect(JSON.parse(outbox.payload)).toMatchObject({
      reconciliationObservationOutcome: 'unknown',
      reconciliationObservationEvidenceReference: 'host-crash-observation-1',
      correlationId: audit.correlation_id,
    });
    expect(outbox.correlation_id).toBe(audit.correlation_id);
    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'observe-pre-provider-crash-replay',
        outcome: 'unknown',
        evidenceReference: 'host-crash-observation-1',
      }),
    ).resolves.toMatchObject({ status: 'reconciliation_required' });
    expect(provider.outcomeCalls).toBe(0);
    await expect(
      resource.resolve(preview.id, {
        idempotencyKey: 'confirm-pre-provider-not-applied',
        outcome: 'not_applied',
        evidenceReference: 'host-confirmed-no-call',
      }),
    ).resolves.toMatchObject({ status: 'failed', executionToken: null });
    await expect(
      database('payable_subscription_mutation_claims').where({ subscription_id: subscription.id }),
    ).resolves.toHaveLength(0);
  });
});
