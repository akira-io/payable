import type { Knex } from 'knex';
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
import { isUniqueViolation } from '../unique-violation';
import {
  catalogSynchronizationFromRow,
  toCatalogSynchronizationPatch,
  toCatalogSynchronizationRow,
} from './catalog-synchronization-row';

const TABLE = 'payable_catalog_synchronizations';

export class KnexCatalogSynchronizationRepository implements CatalogSynchronizationRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async save(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    assertCatalogTenantId(data.tenantId);
    const previous = await this.findByResource(
      data.resourceType,
      data.resourceId,
      data.provider,
      data.tenantId,
    );
    const timestamp = this.clock.now().toISOString();
    const row = toCatalogSynchronizationRow(data);
    await this.knex(TABLE)
      .insert({
        id: previous?.id ?? globalThis.crypto.randomUUID(),
        ...row,
        created_at: previous?.createdAt.toISOString() ?? timestamp,
        updated_at: timestamp,
      })
      .onConflict(['tenant_key', 'provider', 'resource_type', 'resource_id'])
      .merge({ ...row, updated_at: timestamp });
    const saved = await this.findByResource(
      data.resourceType,
      data.resourceId,
      data.provider,
      data.tenantId,
    );
    if (!saved) {
      throw new Error(`${TABLE}: synchronization missing after write`);
    }
    return saved;
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
          const timestamp = this.clock.now().toISOString();
          await this.knex(TABLE).insert({
            id: globalThis.crypto.randomUUID(),
            ...toCatalogSynchronizationRow(data),
            created_at: timestamp,
            updated_at: timestamp,
          });
          return this.requirePersisted(data);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
        continue;
      }
      const updated = await this.knex(TABLE)
        .where(this.key(data))
        .where({ idempotency_key: existing.idempotencyKey, status: existing.status })
        .update({
          ...toCatalogSynchronizationRow(data),
          updated_at: this.clock.now().toISOString(),
        });
      if (updated > 0) return this.requirePersisted(data);
    }
  }

  async update(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
  ): Promise<CatalogSynchronization> {
    assertCatalogTenantId(tenantId);
    const update = toCatalogSynchronizationPatch(patch);
    await this.knex(TABLE)
      .where({
        tenant_key: tenantId ?? '',
        provider,
        resource_type: resourceType,
        resource_id: resourceId,
      })
      .update({ ...update, updated_at: this.clock.now().toISOString() });
    const saved = await this.findByResource(resourceType, resourceId, provider, tenantId);
    if (!saved) {
      throw new Error(`${TABLE}: synchronization missing after update`);
    }
    return saved;
  }

  async findByResource(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CatalogSynchronization | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.knex(TABLE)
      .where({
        tenant_key: tenantId ?? '',
        provider,
        resource_type: resourceType,
        resource_id: resourceId,
      })
      .first();
    return row ? catalogSynchronizationFromRow(row as Record<string, unknown>) : null;
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
    const count = await this.knex(TABLE)
      .where({
        tenant_key: tenantId ?? '',
        provider,
        resource_type: resourceType,
        resource_id: resourceId,
        canonical_version: canonicalVersion,
        idempotency_key: idempotencyKey,
      })
      .where((query) =>
        query
          .whereIn('status', statuses)
          .orWhere((lease) =>
            lease
              .where('status', 'processing')
              .where('lease_expires_at', '<=', attemptedAt.toISOString()),
          ),
      )
      .update({
        status: 'processing',
        last_attempted_at: attemptedAt.toISOString(),
        attempt_owner_id: ownerId,
        lease_expires_at: leaseExpiresAt.toISOString(),
        updated_at: this.clock.now().toISOString(),
      });
    return count === 0 ? null : this.findByResource(resourceType, resourceId, provider, tenantId);
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
    const query = this.knex(TABLE).where({
      tenant_key: tenantId ?? '',
      provider,
      resource_type: resourceType,
      resource_id: resourceId,
      canonical_version: canonicalVersion,
      idempotency_key: idempotencyKey,
    });
    if (statuses) query.whereIn('status', statuses);
    if (ownerId) query.where({ status: 'processing', attempt_owner_id: ownerId });
    const count = await query.update({
      ...toCatalogSynchronizationPatch(patch),
      updated_at: this.clock.now().toISOString(),
    });
    return count === 0 ? null : this.findByResource(resourceType, resourceId, provider, tenantId);
  }

  private key(data: NewCatalogSynchronization) {
    return {
      tenant_key: data.tenantId ?? '',
      provider: data.provider,
      resource_type: data.resourceType,
      resource_id: data.resourceId,
    };
  }

  private async requirePersisted(data: NewCatalogSynchronization): Promise<CatalogSynchronization> {
    const persisted = await this.findByResource(
      data.resourceType,
      data.resourceId,
      data.provider,
      data.tenantId,
    );
    if (!persisted) throw new Error(`${TABLE}: synchronization missing after write`);
    return persisted;
  }
}
