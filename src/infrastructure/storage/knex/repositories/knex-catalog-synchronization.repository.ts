import type { Knex } from 'knex';
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
    const row = this.toRow(data);
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

  async update(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
  ): Promise<CatalogSynchronization> {
    assertCatalogTenantId(tenantId);
    const update = this.toPatch(patch);
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
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private toRow(data: NewCatalogSynchronization): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      tenant_key: data.tenantId ?? '',
      provider: data.provider,
      resource_type: data.resourceType,
      resource_id: data.resourceId,
      operation: data.operation,
      canonical_version: data.canonicalVersion,
      idempotency_key: data.idempotencyKey,
      status: data.status,
      reconciliation_state: data.reconciliationState,
      provider_resource_id: data.providerResourceId,
      provider_resource_version: data.providerResourceVersion,
      retry_count: data.retryCount,
      last_error_code: data.lastErrorCode,
      last_attempted_at: data.lastAttemptedAt?.toISOString() ?? null,
      last_succeeded_at: data.lastSucceededAt?.toISOString() ?? null,
    };
  }

  private toPatch(patch: CatalogSynchronizationPatch): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const mappings: Array<[keyof CatalogSynchronizationPatch, string]> = [
      ['operation', 'operation'],
      ['canonicalVersion', 'canonical_version'],
      ['idempotencyKey', 'idempotency_key'],
      ['status', 'status'],
      ['reconciliationState', 'reconciliation_state'],
      ['providerResourceId', 'provider_resource_id'],
      ['providerResourceVersion', 'provider_resource_version'],
      ['retryCount', 'retry_count'],
      ['lastErrorCode', 'last_error_code'],
      ['lastAttemptedAt', 'last_attempted_at'],
      ['lastSucceededAt', 'last_succeeded_at'],
    ];
    for (const [property, column] of mappings) {
      const value = patch[property];
      if (value !== undefined) {
        row[column] = value instanceof Date ? value.toISOString() : value;
      }
    }
    return row;
  }

  private toEntity(row: Record<string, unknown>): CatalogSynchronization {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      provider: row.provider as string,
      resourceType: row.resource_type as CatalogSynchronizationResourceType,
      resourceId: row.resource_id as string,
      operation: row.operation as CatalogSynchronizationOperation,
      canonicalVersion: row.canonical_version as string,
      idempotencyKey: row.idempotency_key as string,
      status: row.status as CatalogSynchronizationStatus,
      reconciliationState: row.reconciliation_state as CatalogReconciliationState,
      providerResourceId: (row.provider_resource_id as string | null) ?? null,
      providerResourceVersion: (row.provider_resource_version as string | null) ?? null,
      retryCount: Number(row.retry_count),
      lastErrorCode: (row.last_error_code as string | null) ?? null,
      lastAttemptedAt: row.last_attempted_at
        ? new Date(row.last_attempted_at as string | Date)
        : null,
      lastSucceededAt: row.last_succeeded_at
        ? new Date(row.last_succeeded_at as string | Date)
        : null,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
