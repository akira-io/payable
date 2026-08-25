import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma/prisma-storage.driver';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import {
  createScheduled,
  migrationCasLifecycle,
  migrationInput,
  STORAGE_TIME,
  seedMigrationDependencies,
} from './support/subscription-price-migration-storage-contract';

type UnsafeMigration = Record<string, unknown>;

describe('Prisma canonical subscription price migration storage', () => {
  let client: PrismaClientLike;
  let storage: PrismaStorageDriver;

  beforeAll(async () => {
    client = await createPrismaTestClient();
    storage = new PrismaStorageDriver(client, new FakeClock(STORAGE_TIME));
  });

  afterAll(async () => disconnectPrisma(client));

  it('round-trips snapshots with tenant-scoped retrieval and filters', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'prisma-one');
    const repository = storage.subscriptionPriceMigrations;
    const created = await repository.create(migrationInput(dependencies));

    await expect(repository.findById(created.id, 'migration-tenant')).resolves.toEqual(created);
    await expect(repository.findById(created.id, 'other-tenant')).resolves.toBeNull();
    await expect(repository.findById(created.id, null)).resolves.toBeNull();
    await expect(
      repository.list(
        { limit: 10, status: 'previewed', subscriptionId: dependencies.subscriptionId },
        'migration-tenant',
      ),
    ).resolves.toMatchObject({ items: [{ id: created.id, sourcePrice: { amount: 1_000 } }] });
    expect('update' in repository).toBe(false);
  });

  it('rejects invalid canonical JSON before insert and preserves the active key through CAS', async () => {
    const tenantId = 'migration-prisma-validation-tenant';
    const dependencies = await seedMigrationDependencies(storage, tenantId, 'prisma-validation');
    const repository = storage.subscriptionPriceMigrations;
    const malformed = migrationInput(dependencies, { tenantId }) as unknown as UnsafeMigration;
    const [firstItem] = malformed.currentItems as Record<string, unknown>[];
    malformed.currentItems = [{ ...firstItem, providerItemPayload: 'provider-item' }];
    await expect(repository.create(malformed as never)).rejects.toThrow(/current_items/i);
    const invalidLifecycleInput = migrationInput(dependencies, { tenantId });
    const invalidLifecycle = invalidLifecycleInput as unknown as UnsafeMigration;
    invalidLifecycle.status = 'executing';
    invalidLifecycle.executionToken = 'premature-owner';
    await expect(repository.create(invalidLifecycle as never)).rejects.toThrow(
      /preview_lifecycle/i,
    );
    await expect(
      client.payableSubscriptionPriceMigration.count({ where: { tenantKey: tenantId } }),
    ).resolves.toBe(0);

    const created = await repository.create(migrationInput(dependencies, { tenantId }));
    await expect(
      client.payableSubscriptionPriceMigration.findFirst({ where: { id: created.id } }),
    ).resolves.toMatchObject({ activeSubscriptionId: dependencies.subscriptionId });
    const invalidStart = await repository.compareAndSwapState({
      id: created.id,
      tenantId,
      expectedStatus: 'previewed',
      expectedExecutionToken: 'existing-owner',
      nextStatus: 'executing',
      executionToken: 'new-owner',
      ...migrationCasLifecycle({ attemptCount: 1, executionStartedAt: STORAGE_TIME }),
    } as never);
    const invalidCancel = await repository.compareAndSwapState({
      id: created.id,
      tenantId,
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'cancelled',
      executionToken: 'retained-owner',
      ...migrationCasLifecycle({ cancelledAt: STORAGE_TIME }),
    } as never);
    expect(invalidStart).toBeNull();
    expect(invalidCancel).toBeNull();
    await expect(repository.findById(created.id, tenantId)).resolves.toMatchObject({
      status: 'previewed',
      executionToken: null,
    });
    const cancelled = await repository.compareAndSwapState({
      id: created.id,
      tenantId,
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'cancelled',
      executionToken: null,
      ...migrationCasLifecycle({ cancelledAt: STORAGE_TIME }),
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', executionToken: null });
    await expect(
      client.payableSubscriptionPriceMigration.findFirst({ where: { id: created.id } }),
    ).resolves.toMatchObject({ activeSubscriptionId: null });
    await client.payableSubscriptionPriceMigration.update({
      where: { id: created.id },
      data: { executionToken: 'orphan-owner' },
    });
    await expect(repository.findById(created.id, tenantId)).rejects.toThrow(/execution_token/i);
    await client.payableSubscriptionPriceMigration.update({
      where: { id: created.id },
      data: {
        status: 'executing',
        executionToken: null,
        activeSubscriptionId: created.subscriptionId,
      },
    });
    await expect(repository.findById(created.id, tenantId)).rejects.toThrow(/execution_token/i);
  });

  it('enforces active uniqueness and exact execution ownership', async () => {
    const dependencies = await seedMigrationDependencies(storage, 'migration-tenant', 'prisma-cas');
    const repository = storage.subscriptionPriceMigrations;
    const created = await repository.create(migrationInput(dependencies));
    await expect(
      repository.create(
        migrationInput(dependencies, { previewToken: 'duplicate', requestHash: 'duplicate' }),
      ),
    ).rejects.toThrow();
    const executing = await repository.compareAndSwapState({
      id: created.id,
      tenantId: 'migration-tenant',
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'executing',
      executionToken: 'prisma-owner',
      ...migrationCasLifecycle({ attemptCount: 1, executionStartedAt: STORAGE_TIME }),
    });
    expect(executing).toMatchObject({ status: 'executing', executionToken: 'prisma-owner' });
    const appliedAt = new Date('2026-08-25T10:04:00.000Z');
    await expect(
      repository.compareAndSwapState({
        id: created.id,
        tenantId: 'migration-tenant',
        expectedStatus: 'executing',
        expectedExecutionToken: 'wrong-owner',
        nextStatus: 'applied',
        executionToken: 'wrong-owner',
        ...migrationCasLifecycle({
          attemptCount: 1,
          executionStartedAt: STORAGE_TIME,
          appliedAt,
          updatedAt: appliedAt,
        }),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.compareAndSwapState({
        id: created.id,
        tenantId: 'migration-tenant',
        expectedStatus: 'executing',
        expectedExecutionToken: 'prisma-owner',
        nextStatus: 'applied',
        executionToken: 'prisma-owner',
        ...migrationCasLifecycle({
          attemptCount: 1,
          executionStartedAt: STORAGE_TIME,
          appliedAt,
          updatedAt: appliedAt,
        }),
      }),
    ).resolves.toMatchObject({ status: 'applied', sourcePrice: created.sourcePrice });
    await expect(
      repository.compareAndSwapState({
        id: created.id,
        tenantId: 'migration-tenant',
        expectedStatus: 'applied',
        expectedExecutionToken: 'prisma-owner',
        nextStatus: 'reconciliation_required',
        executionToken: 'prisma-owner',
        ...migrationCasLifecycle({
          attemptCount: 1,
          executionStartedAt: STORAGE_TIME,
          appliedAt,
          reconciliationRequiredAt: appliedAt,
          updatedAt: appliedAt,
        }),
      } as never),
    ).resolves.toBeNull();
    await expect(repository.findById(created.id, 'migration-tenant')).resolves.toMatchObject({
      status: 'applied',
      reconciliationRequiredAt: null,
    });
    await expect(
      repository.create(
        migrationInput(dependencies, { previewToken: 'successor', requestHash: 'successor' }),
      ),
    ).resolves.toBeDefined();
  });

  it('paginates equal timestamps and persists stable failure details', async () => {
    const tenantId = 'migration-prisma-page-tenant';
    const firstDependencies = await seedMigrationDependencies(storage, tenantId, 'prisma-failure');
    const secondDependencies = await seedMigrationDependencies(storage, tenantId, 'prisma-page');
    const repository = storage.subscriptionPriceMigrations;
    const first = await repository.create(migrationInput(firstDependencies, { tenantId }));
    const second = await repository.create(migrationInput(secondDependencies, { tenantId }));
    await repository.compareAndSwapState({
      id: first.id,
      tenantId,
      expectedStatus: 'previewed',
      expectedExecutionToken: null,
      nextStatus: 'executing',
      executionToken: 'failure-owner',
      ...migrationCasLifecycle({ attemptCount: 1, executionStartedAt: STORAGE_TIME }),
    });
    const failedAt = new Date('2026-08-25T10:05:00.000Z');
    await repository.compareAndSwapState({
      id: first.id,
      tenantId,
      expectedStatus: 'executing',
      expectedExecutionToken: 'failure-owner',
      nextStatus: 'failed',
      executionToken: null,
      ...migrationCasLifecycle({
        attemptCount: 1,
        failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
        failureMessage: 'Provider did not apply the subscription migration',
        executionStartedAt: STORAGE_TIME,
        failedAt,
        updatedAt: failedAt,
      }),
    });

    await expect(
      repository.list(
        { limit: 10, status: 'failed', subscriptionId: firstDependencies.subscriptionId },
        tenantId,
      ),
    ).resolves.toMatchObject({
      items: [
        {
          id: first.id,
          executionToken: null,
          failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
          failureMessage: 'Provider did not apply the subscription migration',
          failedAt,
        },
      ],
    });
    const ordered = [first, second].sort((left, right) => right.id.localeCompare(left.id));
    const newest = ordered[0];
    const oldest = ordered[1];
    if (!newest || !oldest) throw new Error('Expected two migrations');
    const page = await repository.list({ limit: 1 }, tenantId);
    expect(page).toMatchObject({ hasMore: true, items: [{ id: newest.id }] });
    await expect(
      repository.list(
        { limit: 1, before: { createdAt: newest.createdAt, id: newest.id } },
        tenantId,
      ),
    ).resolves.toMatchObject({ hasMore: false, items: [{ id: oldest.id }] });
  });

  it('orders due pages by ascending effective date and ID', async () => {
    const repository = storage.subscriptionPriceMigrations;
    const [firstDependencies, secondDependencies, thirdDependencies] = await Promise.all([
      seedMigrationDependencies(storage, 'migration-tenant', 'prisma-due-a'),
      seedMigrationDependencies(storage, 'migration-tenant', 'prisma-due-b'),
      seedMigrationDependencies(storage, 'migration-tenant', 'prisma-due-c'),
    ]);
    const noon = new Date('2026-08-25T12:00:00.000Z');
    const [later, earlier, laterTie] = await Promise.all([
      createScheduled(repository, firstDependencies, noon),
      createScheduled(repository, secondDependencies, new Date('2026-08-25T11:00:00.000Z')),
      createScheduled(repository, thirdDependencies, noon),
    ]);
    const laterById = [later, laterTie].sort((left, right) => left.id.localeCompare(right.id));

    const first = await repository.pageDueScheduled(
      { limit: 1, dueBefore: new Date('2026-08-25T13:00:00.000Z') },
      'migration-tenant',
    );
    expect(first).toMatchObject({ hasMore: true, items: [{ id: earlier.id }] });
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
});
