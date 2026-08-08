import type {
  CatalogSynchronizationPatch,
  CatalogSynchronizationRepository,
  NewCatalogSynchronization,
} from '../../../../domain/contracts/catalog-synchronization-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
  CatalogSynchronizationStatus,
} from '../../../../domain/entities/catalog-synchronization.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import type { PrismaClient } from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';
import {
  catalogSynchronizationFromPrismaRow,
  catalogSynchronizationValues,
} from './catalog-synchronization-row';

export class PrismaCatalogSynchronizationRepository implements CatalogSynchronizationRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async save(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    assertCatalogTenantId(data.tenantId);
    const now = this.clock.now();
    const values = catalogSynchronizationValues(data);
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
    return catalogSynchronizationFromPrismaRow(row);
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
      if (existing && data.canonicalVersion < existing.canonicalVersion) {
        return existing;
      }
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
              ...catalogSynchronizationValues(data),
              createdAt: now,
              updatedAt: now,
            },
          });
          return catalogSynchronizationFromPrismaRow(row);
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
        data: { ...catalogSynchronizationValues(data), updatedAt: this.clock.now() },
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
    return catalogSynchronizationFromPrismaRow(row);
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
    return row ? catalogSynchronizationFromPrismaRow(row) : null;
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
    if (!allowFailedRetry) {
      await this.client.payableCatalogSynchronization.updateMany({
        where: {
          tenantKey: tenantId ?? '',
          provider,
          resourceType,
          resourceId,
          canonicalVersion,
          idempotencyKey,
          status: 'processing',
          leaseExpiresAt: { lte: attemptedAt },
        },
        data: {
          status: 'failed',
          reconciliationState: 'required',
          lastErrorCode: 'CATALOG_SYNC_LEASE_EXPIRED',
          attemptOwnerId: null,
          leaseExpiresAt: null,
          updatedAt: this.clock.now(),
        },
      });
    }
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
          ...(allowFailedRetry
            ? [{ status: 'processing', leaseExpiresAt: { lte: attemptedAt } }]
            : []),
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
    if (result.count === 0) return null;
    const claimed = await this.findByResource(resourceType, resourceId, provider, tenantId);
    return claimed?.attemptOwnerId === ownerId &&
      claimed.status === 'processing' &&
      claimed.canonicalVersion === canonicalVersion &&
      claimed.idempotencyKey === idempotencyKey
      ? claimed
      : null;
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
