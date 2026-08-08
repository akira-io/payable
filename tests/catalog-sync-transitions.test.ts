import { describe, expect, it, vi } from 'vitest';
import { recordCatalogSyncTransition } from '../src/application/services/catalog-sync/catalog-sync-transitions';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import type { CatalogSynchronization } from '../src/domain/entities/catalog-synchronization.entity';

describe('catalog synchronization transitions', () => {
  it('does not dedupe distinct remote evidence or error transitions', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const repositories = {
      auditLogs: { create: vi.fn().mockResolvedValue(undefined) },
      outboxEvents: { create },
    } as unknown as Repositories;
    const synchronization = sampleSynchronization();

    await recordCatalogSyncTransition(repositories, synchronization, 'correlation-one');
    await recordCatalogSyncTransition(
      repositories,
      {
        ...synchronization,
        providerResourceId: 'prod_2',
        lastErrorCode: 'SECOND_FAILURE',
      },
      'correlation-two',
    );

    const firstKey = create.mock.calls[0]?.[0].dedupeKey as string;
    const secondKey = create.mock.calls[1]?.[0].dedupeKey as string;
    expect(firstKey).not.toBe(secondKey);
    expect(secondKey.length).toBeLessThanOrEqual(255);
    await recordCatalogSyncTransition(
      repositories,
      {
        ...synchronization,
        providerResourceId: 'prod_2',
        lastErrorCode: 'SECOND_FAILURE',
      },
      'a-different-correlation',
    );
    expect(create.mock.calls[2]?.[0].dedupeKey).toBe(secondKey);
  });
});

function sampleSynchronization(): CatalogSynchronization {
  const now = new Date('2026-08-08T10:00:00.000Z');
  return {
    id: 'sync_1',
    tenantId: null,
    provider: 'stripe-primary',
    resourceType: 'product',
    resourceId: 'product_1',
    operation: 'create',
    canonicalVersion: now.toISOString(),
    idempotencyKey: 'provider-operation-key',
    status: 'failed',
    reconciliationState: 'pending',
    providerResourceId: 'prod_1',
    providerResourceVersion: 'remote-v1',
    retryCount: 1,
    lastErrorCode: 'FIRST_FAILURE',
    lastAttemptedAt: now,
    lastSucceededAt: null,
    attemptOwnerId: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
