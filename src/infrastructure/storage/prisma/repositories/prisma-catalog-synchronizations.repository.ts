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
import { isPrismaUniqueViolation } from '../unique-violation';

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

  async requestGeneration(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    assertCatalogTenantId(data.tenantId);
    for (;;) {
      const existing = await this.findByResource(
        data.resourceType,
        data.resourceId,
        data.provider,
        data.tenantId,
      );
      if (
        existing?.idempotencyKey === data.idempotencyKey &&
        ['requested', 'processing', 'retrying', 'succeeded'].includes(existing.status)
      ) {
        return existing;
      }
      if (!existing) {
        try {
          const now = this.clock.now();
          const row = await this.client.payableCatalogSynchronization.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              ...this.values(data),
              createdAt: now,
              updatedAt: now,
            },
          });
          return this.toEntity(row);
        } catch (error) {
          if (!isPrismaUniqueViolation(error)) {
            throw error;
          }
        }
        continue;
      }
      const { count } = await this.client.payableCatalogSynchronization.updateMany({
        where: {
          ...this.key(data),
          idempotencyKey: existing.idempotencyKey,
          status: existing.status,
        },
        data: { ...this.values(data), updatedAt: this.clock.now() },
      });
      if (count > 0) {
        return this.requirePersisted(data);
      }
    }
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

  async claimGeneration(
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
  ): Promise<CatalogSynchronization | null> {
    assertCatalogTenantId(tenantId);
    const statuses = allowFailedRetry
      ? ['requested', 'retrying', 'failed']
      : ['requested', 'retrying'];
    const result = await this.client.payableCatalogSynchronization.updateMany({
      where: {
        tenantKey: tenantId ?? '',
        provider,
        resourceType,
        resourceId,
        canonicalVersion,
        idempotencyKey,
        OR: [
          { status: { in: statuses } },
          { status: 'processing', leaseExpiresAt: { lte: attemptedAt } },
        ],
      },
      data: {
        status: 'processing',
        lastAttemptedAt: attemptedAt,
        attemptOwnerId: ownerId,
        leaseExpiresAt,
        updatedAt: this.clock.now(),
      },
    });
    return result.count === 0
      ? null
      : this.findByResource(resourceType, resourceId, provider, tenantId);
  }

  async updateIfCurrent(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
    ownerId?: string,
    expectedStatuses?: CatalogSynchronizationStatus[],
  ): Promise<CatalogSynchronization | null> {
    return this.compareAndSet(
      resourceType,
      resourceId,
      provider,
      canonicalVersion,
      idempotencyKey,
      { ...patch, ...(ownerId ? { attemptOwnerId: null, leaseExpiresAt: null } : {}) },
      tenantId,
      expectedStatuses,
      ownerId,
    );
  }

  private async compareAndSet(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    canonicalVersion: string,
    idempotencyKey: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
    statuses?: string[],
    ownerId?: string,
  ): Promise<CatalogSynchronization | null> {
    assertCatalogTenantId(tenantId);
    const result = await this.client.payableCatalogSynchronization.updateMany({
      where: {
        tenantKey: tenantId ?? '',
        provider,
        resourceType,
        resourceId,
        canonicalVersion,
        idempotencyKey,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(ownerId ? { status: 'processing', attemptOwnerId: ownerId } : {}),
      },
      data: { ...patch, updatedAt: this.clock.now() },
    });
    return result.count === 0
      ? null
      : this.findByResource(resourceType, resourceId, provider, tenantId);
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
      attemptOwnerId: data.attemptOwnerId ?? null,
      leaseExpiresAt: data.leaseExpiresAt ?? null,
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
      attemptOwnerId: row.attemptOwnerId,
      leaseExpiresAt: row.leaseExpiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private key(data: NewCatalogSynchronization) {
    return {
      tenantKey: data.tenantId ?? '',
      provider: data.provider,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    };
  }

  private async requirePersisted(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    const persisted = await this.findByResource(
      data.resourceType,
      data.resourceId,
      data.provider,
      data.tenantId,
    );
    if (!persisted) {
      throw new Error('Catalog synchronization missing after write');
    }
    return persisted;
  }
}
