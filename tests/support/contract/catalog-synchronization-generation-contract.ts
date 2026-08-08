import { expect, it } from 'vitest';
import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
} from '../../../src/domain/entities/catalog-synchronization.entity';
import type { ContractContext } from './harness';

interface GenerationRepository {
  claimGeneration(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    tenantId: string | null,
    attemptedAt: Date,
  ): Promise<CatalogSynchronization | null>;
  updateIfCurrent(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    patch: Partial<CatalogSynchronization>,
    tenantId: string | null,
  ): Promise<CatalogSynchronization | null>;
}

export function registerCatalogSynchronizationGenerationContract(ctx: ContractContext): void {
  it('claims one generation once and rejects stale completion', async () => {
    const { storage, clock } = ctx.harness();
    const repository = storage.catalogSynchronizations as unknown as GenerationRepository;
    const resourceId = globalThis.crypto.randomUUID();
    await storage.catalogSynchronizations?.save({
      tenantId: 'tenant-generation',
      provider: 'stripe-primary',
      resourceType: 'product',
      resourceId,
      operation: 'create',
      canonicalVersion: 'version-2',
      idempotencyKey: 'generation-2',
      status: 'requested',
      reconciliationState: 'pending',
      providerResourceId: null,
      providerResourceVersion: null,
      retryCount: 0,
      lastErrorCode: null,
      lastAttemptedAt: null,
      lastSucceededAt: null,
    });

    const claims = await Promise.all([
      repository.claimGeneration(
        'product',
        resourceId,
        'stripe-primary',
        'version-2',
        'generation-2',
        'tenant-generation',
        clock.now(),
      ),
      repository.claimGeneration(
        'product',
        resourceId,
        'stripe-primary',
        'version-2',
        'generation-2',
        'tenant-generation',
        clock.now(),
      ),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(
      repository.updateIfCurrent(
        'product',
        resourceId,
        'stripe-primary',
        'version-1',
        'generation-1',
        { status: 'succeeded' },
        'tenant-generation',
      ),
    ).resolves.toBeNull();
    await expect(
      repository.updateIfCurrent(
        'product',
        resourceId,
        'stripe-primary',
        'version-2',
        'generation-2',
        { status: 'succeeded' },
        'tenant-generation',
      ),
    ).resolves.toMatchObject({ status: 'succeeded', idempotencyKey: 'generation-2' });
  });
}
