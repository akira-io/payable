import type {
  CatalogSynchronizationPatch,
  CatalogSynchronizationRepository,
  NewCatalogSynchronization,
} from '../../../../domain/contracts/catalog-synchronization-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CatalogReconciliationState,
  CatalogSynchronization,
  CatalogSynchronizationOperation,
  CatalogSynchronizationResourceType,
  CatalogSynchronizationStatus,
} from '../../../../domain/entities/catalog-synchronization.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import type { PrismaCatalogSynchronizationRow, PrismaClient } from '../prisma-client.types';

export class PrismaCatalogSynchronizationRepository implements CatalogSynchronizationRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async save(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    assertCatalogTenantId(data.tenantId);
    const now = this.clock.now();
    const values = this.values(data);
    const row = await this.client.payableCatalogSynchronization.upsert({
      where: {
        tenantKey_provider_resourceType_resourceId: {
          tenantKey: data.tenantId ?? '',
          provider: data.provider,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
        },
      },
      create: {
        id: globalThis.crypto.randomUUID(),
        ...values,
        createdAt: now,
        updatedAt: now,
      },
      update: { ...values, updatedAt: now },
    });
    return this.toEntity(row);
  }

  async update(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
  ): Promise<CatalogSynchronization> {
    const current = await this.findByResource(resourceType, resourceId, provider, tenantId);
    if (!current) {
      throw new Error('Catalog synchronization missing after update');
    }
    const row = await this.client.payableCatalogSynchronization.update({
      where: { id: current.id },
      data: { ...patch, updatedAt: this.clock.now() },
    });
    return this.toEntity(row);
  }

  async findByResource(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CatalogSynchronization | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.client.payableCatalogSynchronization.findFirst({
      where: {
        tenantKey: tenantId ?? '',
        provider,
        resourceType,
        resourceId,
      },
    });
    return row ? this.toEntity(row) : null;
  }

  private values(data: NewCatalogSynchronization): Record<string, unknown> {
    return {
      tenantId: data.tenantId,
      tenantKey: data.tenantId ?? '',
      provider: data.provider,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      operation: data.operation,
      canonicalVersion: data.canonicalVersion,
      idempotencyKey: data.idempotencyKey,
      status: data.status,
      reconciliationState: data.reconciliationState,
      providerResourceId: data.providerResourceId,
      providerResourceVersion: data.providerResourceVersion,
      retryCount: data.retryCount,
      lastErrorCode: data.lastErrorCode,
      lastAttemptedAt: data.lastAttemptedAt,
      lastSucceededAt: data.lastSucceededAt,
    };
  }

  private toEntity(row: PrismaCatalogSynchronizationRow): CatalogSynchronization {
    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      resourceType: row.resourceType as CatalogSynchronizationResourceType,
      resourceId: row.resourceId,
      operation: row.operation as CatalogSynchronizationOperation,
      canonicalVersion: row.canonicalVersion,
      idempotencyKey: row.idempotencyKey,
      status: row.status as CatalogSynchronizationStatus,
      reconciliationState: row.reconciliationState as CatalogReconciliationState,
      providerResourceId: row.providerResourceId,
      providerResourceVersion: row.providerResourceVersion,
      retryCount: row.retryCount,
      lastErrorCode: row.lastErrorCode,
      lastAttemptedAt: row.lastAttemptedAt,
      lastSucceededAt: row.lastSucceededAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
