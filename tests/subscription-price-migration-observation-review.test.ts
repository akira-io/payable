import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MigrationOutcomePreviewProvider,
  type MigrationPreviewDatabase,
  migrationPreviewInput,
  setupMigrationPreview,
  MIGRATION_TENANT as TENANT,
} from './support/subscription-price-migration-preview';

describe('subscription price migration unknown observation', () => {
  const databases: MigrationPreviewDatabase[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

  it('records the first post-ambiguity observation and replays it immutably', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-post-ambiguity-observation',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous provider timeout');
    await expect(
      resource.approve(preview.id, { idempotencyKey: 'create-ambiguity-before-observation' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' });

    const observation = {
      idempotencyKey: 'observe-existing-reconciliation',
      outcome: 'unknown' as const,
      evidenceReference: 'operator-observation-after-timeout',
    };
    await expect(resource.resolve(preview.id, observation)).resolves.toMatchObject({
      status: 'reconciliation_required',
      reconciliationObservationEvidenceReference: observation.evidenceReference,
    });
    await expect(
      resource.resolve(preview.id, { ...observation, idempotencyKey: 'replay-observation' }),
    ).resolves.toMatchObject({
      reconciliationObservationEvidenceReference: observation.evidenceReference,
    });
    await expect(
      resource.resolve(preview.id, {
        ...observation,
        idempotencyKey: 'conflicting-observation',
        evidenceReference: 'different-operator-observation',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_MIGRATION_STATE_CONFLICT' });
    const events = await database('payable_outbox_events')
      .where({ event_type: 'subscription.price_migration.reconciliation_required.v1' })
      .orderBy('created_at');
    expect(events).toHaveLength(2);
    expect(new Set(events.map(({ dedupe_key }) => dedupe_key)).size).toBe(2);
    const audits = await database('payable_audit_logs')
      .where({
        resource_id: preview.id,
        action: 'subscription.price_migration.reconciliation_required',
      })
      .orderBy('created_at');
    expect(audits).toHaveLength(2);
  });

  it('allows only one of two concurrent observations to establish immutable evidence', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { payable, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-concurrent-observation',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous provider timeout');
    await resource
      .approve(preview.id, { idempotencyKey: 'create-concurrent-observation-ambiguity' })
      .catch(() => undefined);

    const outcomes = await Promise.allSettled(
      ['observation-a', 'observation-b'].map((evidenceReference) =>
        resource.resolve(preview.id, {
          idempotencyKey: `concurrent-${evidenceReference}`,
          outcome: 'unknown',
          evidenceReference,
        }),
      ),
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const persisted = await resource.retrieve(preview.id);
    expect(['observation-a', 'observation-b']).toContain(
      persisted.reconciliationObservationEvidenceReference,
    );
  });

  it('records one transition for concurrent identical observations', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-identical-concurrent-observation',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous provider timeout');
    await resource
      .approve(preview.id, { idempotencyKey: 'create-identical-observation-ambiguity' })
      .catch(() => undefined);
    const repository = storage.subscriptionPriceMigrations;
    const resolveReconciliation = repository.resolveReconciliation.bind(repository);
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(repository, 'resolveReconciliation').mockImplementation(async (input) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothArrived;
      return resolveReconciliation(input);
    });

    const outcomes = await Promise.allSettled(
      ['first', 'second'].map((suffix) =>
        resource.resolve(preview.id, {
          idempotencyKey: `concurrent-identical-${suffix}`,
          outcome: 'unknown',
          evidenceReference: 'same-operator-observation',
        }),
      ),
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    await expect(
      database('payable_outbox_events').where({
        event_type: 'subscription.price_migration.reconciliation_required.v1',
      }),
    ).resolves.toHaveLength(2);
    await expect(
      database('payable_audit_logs').where({
        resource_id: preview.id,
        action: 'subscription.price_migration.reconciliation_required',
      }),
    ).resolves.toHaveLength(2);
  });

  it('does not record a transition for a stale concurrent identical replay', async () => {
    const provider = new MigrationOutcomePreviewProvider();
    const { database, payable, storage, subscription, target } = await setupMigrationPreview(
      databases,
      'stripe',
      provider,
    );
    const resource = payable.subscriptionPriceMigrations(TENANT);
    const preview = await resource.preview({
      ...migrationPreviewInput,
      idempotencyKey: 'preview-stale-identical-observation',
      subscriptionId: subscription.id,
      targetPriceId: target.id,
    });
    provider.outcomeError = new Error('ambiguous provider timeout');
    await resource
      .approve(preview.id, { idempotencyKey: 'create-stale-observation-ambiguity' })
      .catch(() => undefined);
    const observation = {
      outcome: 'unknown' as const,
      evidenceReference: 'concurrent-winner-observation',
    };
    await resource.resolve(preview.id, {
      ...observation,
      idempotencyKey: 'concurrent-observation-winner',
    });
    const repository = storage.subscriptionPriceMigrations;
    const persisted = await repository.findById(preview.id, TENANT);
    if (!persisted) throw new Error('Expected persisted observation');
    vi.spyOn(storage, 'transaction').mockImplementation((work) => work(storage));
    const findById = repository.findById.bind(repository);
    vi.spyOn(repository, 'findById')
      .mockResolvedValueOnce({
        ...persisted,
        reconciliationObservationEvidenceReference: null,
        reconciliationObservedAt: null,
      })
      .mockResolvedValueOnce({
        ...persisted,
        reconciliationObservationEvidenceReference: null,
        reconciliationObservedAt: null,
      })
      .mockImplementation(findById);

    await expect(
      resource.resolve(preview.id, {
        ...observation,
        idempotencyKey: 'stale-concurrent-observation-loser',
      }),
    ).resolves.toMatchObject({
      reconciliationObservationEvidenceReference: observation.evidenceReference,
    });
    await expect(
      database('payable_outbox_events').where({
        event_type: 'subscription.price_migration.reconciliation_required.v1',
      }),
    ).resolves.toHaveLength(2);
    await expect(
      database('payable_audit_logs').where({
        resource_id: preview.id,
        action: 'subscription.price_migration.reconciliation_required',
      }),
    ).resolves.toHaveLength(2);
  });
});
