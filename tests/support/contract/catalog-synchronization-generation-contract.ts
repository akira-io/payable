import { expect, it } from 'vitest';
import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
} from '../../../src/domain/entities/catalog-synchronization.entity';
import type { ContractContext } from './harness';

type Generation = Omit<CatalogSynchronization, 'id' | 'createdAt' | 'updatedAt'>;

interface GenerationRepository {
  requestGeneration(data: Generation): Promise<CatalogSynchronization>;
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

function synchronization(resourceId: string): Generation {
  return {
    tenantId: 'tenant-generation',
    provider: 'stripe-primary',
    resourceType: 'product',
    resourceId,
    operation: 'create',
    canonicalVersion: 'version-lease',
    idempotencyKey: 'generation-lease',
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
