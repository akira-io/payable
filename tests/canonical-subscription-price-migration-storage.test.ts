import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubscriptionPriceMigrationRepository } from '../src/domain/contracts';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import {
  createScheduled,
  migrationCasLifecycle,
  migrationInput,
  STORAGE_TIME,
  seedMigrationDependencies,
} from './support/subscription-price-migration-storage-contract';

describe('Knex canonical subscription price migration storage', () => {
  let database: Knex;
  let storage: KnexStorageDriver;
  let repository: SubscriptionPriceMigrationRepository;

  beforeEach(async () => {
    database = createTestDb();
    await migrate(database);
    storage = new KnexStorageDriver(database, new FakeClock(STORAGE_TIME));
    repository = storage.subscriptionPriceMigrations;
  });

  afterEach(async () => database.destroy());

  it('round-trips immutable JSON snapshots and hides rows from other tenants', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'roundtrip');
    const created = await repository.create(migrationInput(dependencies));

    expect(await repository.findById(created.id, 'migration-tenant')).toEqual(created);
    expect(await repository.findById(created.id, 'other-tenant')).toBeNull();
    expect(await repository.findById(created.id, null)).toBeNull();
    expect(await repository.list({ limit: 10 }, 'other-tenant')).toEqual({
      items: [],
      hasMore: false,
    });
    expect(created).toMatchObject({
      sourcePrice: { amount: 1_000, currency: 'EUR' },
      proposedItems: [{ quantity: 2 }],
      nextRenewal: { date: new Date('2026-09-25T10:00:00.000Z') },
    });
    expect('update' in repository).toBe(false);
    (created.sourcePrice as { amount: number }).amount = 9_999;
    await expect(repository.findById(created.id, 'migration-tenant')).resolves.toMatchObject({
      status: 'previewed',
      sourcePrice: { amount: 1_000 },
    });
  });

  it('rejects claimed start/cancel inputs and invalid canonical JSON without writing', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'invalid');
    const malformed = migrationInput(dependencies) as unknown as Record<string, unknown>;
    malformed.sourcePrice = {
      ...(malformed.sourcePrice as Record<string, unknown>),
      providerPayload: { price: 'provider-price' },
    };
    await expect(repository.create(malformed as never)).rejects.toThrow(/source_price/i);
    const invalidLifecycle = migrationInput(dependencies) as unknown as Record<string, unknown>;
    invalidLifecycle.status = 'scheduled';
    invalidLifecycle.scheduledAt = STORAGE_TIME;
    await expect(repository.create(invalidLifecycle as never)).rejects.toThrow(
      /preview_lifecycle/i,
    );
    expect(
      await database('payable_subscription_price_migrations').count({ count: '*' }).first(),
    ).toMatchObject({ count: 0 });

    const normalizedInput = migrationInput(dependencies) as unknown as Record<string, unknown>;
    (normalizedInput.sourcePrice as Record<string, unknown>).currency = 'eur';
    (normalizedInput.targetPrice as Record<string, unknown>).currency = 'eur';
    (normalizedInput.immediateAdjustment as Record<string, unknown>).currency = 'eur';
    const created = await repository.create(normalizedInput as never);
    expect(created).toMatchObject({
      sourcePrice: { currency: 'EUR' },
      targetPrice: { currency: 'EUR' },
      immediateAdjustment: { currency: 'EUR' },
    });
    const invalidStart = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: 'existing-owner',
      nextStatus: 'executing',
      executionToken: 'new-owner',
      ...migrationCasLifecycle({ attemptCount: 1, executionStartedAt: STORAGE_TIME }),
    } as never);
    const invalidCancel = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'cancelled',
      executionToken: 'retained-owner',
      ...migrationCasLifecycle({ cancelledAt: STORAGE_TIME }),
    } as never);
    expect(invalidStart).toBeNull();
    expect(invalidCancel).toBeNull();
    await expect(repository.findById(created.id, 'migration-tenant')).resolves.toMatchObject({
      status: 'previewed',
      executionToken: null,
      sourcePrice: { amount: 1_000 },
    });
    const storedSource = JSON.parse(
      (
        await database('payable_subscription_price_migrations')
          .where({ id: created.id })
          .first('source_price')
      ).source_price as string,
    ) as Record<string, unknown>;
    await database('payable_subscription_price_migrations')
      .where({ id: created.id })
      .update({ source_price: JSON.stringify({ ...storedSource, providerPayload: true }) });
    await expect(repository.findById(created.id, 'migration-tenant')).rejects.toThrow(
      /source_price/i,
    );
  });

  it('paginates by descending creation cursor and filters by status and subscription', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'pages');
    const first = await repository.create(migrationInput(dependencies));
    const cancelledAt = new Date('2026-08-25T10:01:00.000Z');
    await repository.compareAndSwapState({
      id: first.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'cancelled',
      executionToken: null,
      attemptCount: 0,
      failureCode: null,
      failureMessage: null,
      executionStartedAt: null,
      appliedAt: null,
      failedAt: null,
      reconciliationRequiredAt: null,
      cancelledAt,
      updatedAt: cancelledAt,
    });
    const second = await repository.create(
      migrationInput(dependencies, { previewToken: 'preview-second', requestHash: 'hash-second' }),
    );
    const ordered = [first, second].sort((left, right) => right.id.localeCompare(left.id));
    const newest = ordered[0];
    const oldest = ordered[1];
    if (!newest || !oldest) throw new Error('Expected two migrations');

    const page = await repository.list({ limit: 1 }, 'migration-tenant');
    expect(page).toMatchObject({ hasMore: true, items: [{ id: newest.id }] });
    await expect(
      repository.list(
        { limit: 1, before: { createdAt: newest.createdAt, id: newest.id } },
        'migration-tenant',
      ),
    ).resolves.toMatchObject({ hasMore: false, items: [{ id: oldest.id }] });
    await expect(
      repository.list(
        { limit: 10, status: 'cancelled', subscriptionId: dependencies.subscriptionId },
        'migration-tenant',
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] });
  });

  it('enforces exact ownership CAS and persists failure fields while preserving snapshots', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'cas');
    const created = await repository.create(migrationInput(dependencies));
    const executing = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'executing',
      executionToken: 'owner-1',
      attemptCount: 1,
      failureCode: null,
      failureMessage: null,
      executionStartedAt: STORAGE_TIME,
      appliedAt: null,
      failedAt: null,
      reconciliationRequiredAt: null,
      cancelledAt: null,
      updatedAt: STORAGE_TIME,
    });
    expect(executing).toMatchObject({ status: 'executing', executionToken: 'owner-1' });
    const failedAt = new Date('2026-08-25T10:02:00.000Z');
    const wrongOwner = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'executing',
      expectedExecutionToken: 'owner-2',
      nextStatus: 'failed',
      executionToken: null,
      attemptCount: 1,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      failureMessage: 'Provider did not apply the subscription migration',
      executionStartedAt: STORAGE_TIME,
      appliedAt: null,
      failedAt,
      reconciliationRequiredAt: null,
      cancelledAt: null,
      updatedAt: failedAt,
    });
    expect(wrongOwner).toBeNull();
    const failed = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'executing',
      expectedExecutionToken: 'owner-1',
      nextStatus: 'failed',
      executionToken: null,
      attemptCount: 1,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      failureMessage: 'Provider did not apply the subscription migration',
      executionStartedAt: STORAGE_TIME,
      appliedAt: null,
      failedAt,
      reconciliationRequiredAt: null,
      cancelledAt: null,
      updatedAt: failedAt,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      executionToken: null,
      failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      sourcePrice: created.sourcePrice,
      proposedItems: created.proposedItems,
    });
  });

  it('orders due scheduled migrations by effective date and ID', async () => {
    const a = await seedMigrationDependencies(storage, 'migration-tenant', 'due-a');
    const b = await seedMigrationDependencies(storage, 'migration-tenant', 'due-b');
    const c = await seedMigrationDependencies(storage, 'migration-tenant', 'due-c');
    const later = await createScheduled(repository, a, new Date('2026-08-25T12:00:00.000Z'));
    const earlier = await createScheduled(repository, b, new Date('2026-08-25T11:00:00.000Z'));
    const laterTie = await createScheduled(repository, c, new Date('2026-08-25T12:00:00.000Z'));
    const laterById = [later, laterTie].sort((left, right) => left.id.localeCompare(right.id));

    const firstPage = await repository.pageDueScheduled(
      { limit: 1, dueBefore: new Date('2026-08-25T13:00:00.000Z') },
      'migration-tenant',
    );
    expect(firstPage).toMatchObject({ hasMore: true, items: [{ id: earlier.id }] });
    await expect(
      repository.pageDueScheduled(
        {
          limit: 2,
          dueBefore: new Date('2026-08-25T13:00:00.000Z'),
          before: { effectiveAt: earlier.effectiveAt, id: earlier.id },
        },
        'migration-tenant',
      ),
    ).resolves.toMatchObject({
      hasMore: false,
      items: laterById.map(({ id }) => ({ id })),
    });
  });

  it('prevents two active migrations for one tenant subscription but permits a successor', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'unique');
    const created = await repository.create(migrationInput(dependencies));
    await expect(
      repository.create(
        migrationInput(dependencies, { previewToken: 'duplicate', requestHash: 'duplicate' }),
      ),
    ).rejects.toThrow();
    const cancelledAt = new Date('2026-08-25T10:03:00.000Z');
    await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'cancelled',
      executionToken: null,
      attemptCount: 0,
      failureCode: null,
      failureMessage: null,
      executionStartedAt: null,
      appliedAt: null,
      failedAt: null,
      reconciliationRequiredAt: null,
      cancelledAt,
      updatedAt: cancelledAt,
    });
    await expect(
      repository.create(
        migrationInput(dependencies, { previewToken: 'successor', requestHash: 'successor' }),
      ),
    ).resolves.toMatchObject({ subscriptionId: dependencies.subscriptionId });
  });
});
