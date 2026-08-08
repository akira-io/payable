import { expect, it } from 'vitest';
import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
} from '../../../src/domain/entities/catalog-synchronization.entity';
import type { ContractContext } from './harness';

type Generation = Omit<CatalogSynchronization, 'id' | 'createdAt' | 'updatedAt'>;

interface GenerationRepository {
  requestGeneration(data: Generation): Promise<CatalogSynchronization>;
  findByResource(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CatalogSynchronization | null>;
  claimGeneration(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    tenantId: string | null,
    attemptedAt: Date,
    ownerId: string,
    leaseExpiresAt: Date,
    allowFailedRetry: boolean,
  ): Promise<CatalogSynchronization | null>;
  updateIfCurrent(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    patch: Partial<CatalogSynchronization>,
    tenantId: string | null,
    ownerId: string,
  ): Promise<CatalogSynchronization | null>;
}

export function registerCatalogSynchronizationGenerationContract(ctx: ContractContext): void {
  it('preserves an active generation lease when a stale requester writes', async () => {
    const { storage, clock } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    const generation = synchronization(resourceId);
    await repository.requestGeneration(generation);
    const claimed = await claim(repository, resourceId, clock.now(), 'lease-owner', false);
    expect(claimed).toMatchObject({ status: 'processing', attemptOwnerId: 'lease-owner' });

    await expect(repository.requestGeneration(generation)).resolves.toMatchObject({
      status: 'processing',
      attemptOwnerId: 'lease-owner',
    });
    await expect(
      claim(repository, resourceId, clock.now(), 'loser-owner', false),
    ).resolves.toBeNull();
  });

  it('fences completion by owner and reclaims retryable native failures', async () => {
    const { storage, clock } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    await repository.requestGeneration({
      ...synchronization(resourceId),
      status: 'failed',
      reconciliationState: 'pending',
    });
    const claimed = await claim(repository, resourceId, clock.now(), 'retry-owner', true);
    expect(claimed).toMatchObject({ status: 'processing', attemptOwnerId: 'retry-owner' });
    await expect(complete(repository, resourceId, 'wrong-owner')).resolves.toBeNull();
    await expect(complete(repository, resourceId, 'retry-owner')).resolves.toMatchObject({
      status: 'succeeded',
      attemptOwnerId: null,
    });
  });

  it('expires a non-idempotent processing lease into manual reconciliation', async () => {
    const { storage, clock } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    await repository.requestGeneration(synchronization(resourceId));
    await claim(repository, resourceId, clock.now(), 'slow-owner', false);
    const expiredAt = new Date(clock.now().getTime() + 30_001);

    await expect(
      claim(repository, resourceId, expiredAt, 'second-owner', false),
    ).resolves.toBeNull();
    await expect(find(repository, resourceId)).resolves.toMatchObject({
      status: 'failed',
      reconciliationState: 'required',
      lastErrorCode: 'CATALOG_SYNC_LEASE_EXPIRED',
      attemptOwnerId: null,
    });
  });

  it('keeps the newest generation when stale requests interleave', async () => {
    const { storage } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    await repository.requestGeneration(
      synchronization(resourceId, '2026-08-08T09:00:00.000Z', 'v0'),
    );
    const originalFind = repository.findByResource.bind(repository);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.findByResource = async (...arguments_) => {
      const snapshot = await originalFind(...arguments_);
      reads += 1;
      if (reads === 2) release();
      if (reads <= 2) await bothRead;
      return snapshot;
    };

    await Promise.all([
      repository.requestGeneration(synchronization(resourceId, '2026-08-08T10:00:00.000Z', 'v1')),
      repository.requestGeneration(synchronization(resourceId, '2026-08-08T11:00:00.000Z', 'v2')),
    ]);

    await expect(find(repository, resourceId)).resolves.toMatchObject({
      canonicalVersion: '2026-08-08T11:00:00.000Z',
      idempotencyKey: 'v2',
    });
  });

  it('does not return a claim that was replaced before its verification read', async () => {
    const { storage, clock } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    await repository.requestGeneration(synchronization(resourceId));
    const originalFind = repository.findByResource.bind(repository);
    const originalClaim = repository.claimGeneration.bind(repository);
    let replacementStarted = false;
    repository.findByResource = async (...arguments_) => {
      if (!replacementStarted) {
        replacementStarted = true;
        const replacementTime = new Date(clock.now().getTime() + 30_001);
        await originalClaim(
          'product',
          resourceId,
          'stripe-primary',
          'version-lease',
          'generation-lease',
          'tenant-generation',
          replacementTime,
          'replacement-owner',
          new Date(replacementTime.getTime() + 30_000),
          true,
        );
      }
      return originalFind(...arguments_);
    };

    await expect(
      claim(repository, resourceId, clock.now(), 'first-owner', true),
    ).resolves.toBeNull();
    await expect(find(repository, resourceId)).resolves.toMatchObject({
      status: 'processing',
      attemptOwnerId: 'replacement-owner',
    });
  });
}

function claim(
  repository: GenerationRepository,
  resourceId: string,
  attemptedAt: Date,
  ownerId: string,
  allowFailedRetry: boolean,
): Promise<CatalogSynchronization | null> {
  return repository.claimGeneration(
    'product',
    resourceId,
    'stripe-primary',
    'version-lease',
    'generation-lease',
    'tenant-generation',
    attemptedAt,
    ownerId,
    new Date(attemptedAt.getTime() + 30_000),
    allowFailedRetry,
  );
}

function complete(
  repository: GenerationRepository,
  resourceId: string,
  ownerId: string,
): Promise<CatalogSynchronization | null> {
  return repository.updateIfCurrent(
    'product',
    resourceId,
    'stripe-primary',
    'version-lease',
    'generation-lease',
    { status: 'succeeded' },
    'tenant-generation',
    ownerId,
  );
}

function find(repository: GenerationRepository, resourceId: string) {
  return repository.findByResource('product', resourceId, 'stripe-primary', 'tenant-generation');
}

function synchronization(
  resourceId: string,
  canonicalVersion = 'version-lease',
  idempotencyKey = 'generation-lease',
): Generation {
  return {
    tenantId: 'tenant-generation',
    provider: 'stripe-primary',
    resourceType: 'product',
    resourceId,
    operation: 'create',
    canonicalVersion,
    idempotencyKey,
    status: 'requested',
    reconciliationState: 'pending',
    providerResourceId: null,
    providerResourceVersion: null,
    retryCount: 0,
    lastErrorCode: null,
    lastAttemptedAt: null,
    lastSucceededAt: null,
    attemptOwnerId: null,
    leaseExpiresAt: null,
  };
}
