import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStatus,
  IdempotencyStore,
} from '../../../../domain/contracts/idempotency-store.contract';
import { fromJson, toJson, toNullableDate } from '../mappers';

export class KnexIdempotencyRepository implements IdempotencyStore {
  private readonly table = 'payable_idempotency_keys';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async find(key: string, tenantId: string | null = null): Promise<IdempotencyRecord | null> {
    const row = await this.knex(this.table)
      .where({ key, tenant_id: this.tenant(tenantId) })
      .first();
    return row ? this.toRecord(row) : null;
  }

  async acquire(record: IdempotencyRecord, tenantId: string | null = null): Promise<boolean> {
    const tenant = this.tenant(tenantId);
    const timestamp = this.clock.now().toISOString();
    try {
      await this.knex(this.table).insert({
        id: globalThis.crypto.randomUUID(),
        tenant_id: tenant,
        created_at: timestamp,
        ...this.row(record, timestamp),
      });
      return true;
    } catch (error) {
      const existing = await this.knex(this.table)
        .where({ key: record.key, tenant_id: tenant })
        .first();
      if (existing) {
        return false;
      }
      throw error;
    }
  }

  async put(record: IdempotencyRecord, tenantId: string | null = null): Promise<void> {
    const tenant = this.tenant(tenantId);
    const timestamp = this.clock.now().toISOString();
    const existing = await this.knex(this.table)
      .where({ key: record.key, tenant_id: tenant })
      .first();
    if (existing) {
      await this.knex(this.table).where({ id: existing.id }).update(this.row(record, timestamp));
      return;
    }
    await this.knex(this.table).insert({
      id: globalThis.crypto.randomUUID(),
      tenant_id: tenant,
      created_at: timestamp,
      ...this.row(record, timestamp),
    });
  }

  async markCompleted(
    key: string,
    response: unknown,
    tenantId: string | null = null,
  ): Promise<void> {
    await this.knex(this.table)
      .where({ key, tenant_id: this.tenant(tenantId) })
      .update({
        status: 'completed',
        response: JSON.stringify(response ?? null),
        locked_until: null,
        updated_at: this.clock.now().toISOString(),
      });
  }

  async markFailed(key: string, tenantId: string | null = null): Promise<void> {
    await this.knex(this.table)
      .where({ key, tenant_id: this.tenant(tenantId) })
      .update({ status: 'failed', locked_until: null, updated_at: this.clock.now().toISOString() });
  }

  private tenant(tenantId: string | null): string {
    return tenantId ?? '';
  }

  private row(record: IdempotencyRecord, timestamp: string): Record<string, unknown> {
    return {
      key: record.key,
      scope: record.scope,
      operation: record.operation,
      resource_type: record.resourceType,
      resource_id: record.resourceId,
      request_hash: record.requestHash,
      response: fromJson(record.response) ?? null,
      status: record.status,
      locked_until: record.lockedUntil ? record.lockedUntil.toISOString() : null,
      expires_at: record.expiresAt ? record.expiresAt.toISOString() : null,
      updated_at: timestamp,
    };
  }

  private toRecord(row: Record<string, unknown>): IdempotencyRecord {
    return {
      key: row.key as string,
      scope: row.scope as string,
      operation: row.operation as string,
      resourceType: (row.resource_type as string | null) ?? null,
      resourceId: (row.resource_id as string | null) ?? null,
      requestHash: row.request_hash as string,
      response: toJson(row.response),
      status: row.status as IdempotencyStatus,
      lockedUntil: toNullableDate(row.locked_until),
      expiresAt: toNullableDate(row.expires_at),
    };
  }
}
