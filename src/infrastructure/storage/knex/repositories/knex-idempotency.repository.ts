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
    const row = await this.knex(this.table).where({ key, tenant_id: tenantId }).first();
    return row ? this.toRecord(row) : null;
  }

  async put(record: IdempotencyRecord, tenantId: string | null = null): Promise<void> {
    const timestamp = this.clock.now().toISOString();
    const data = {
      key: record.key,
      tenant_id: tenantId,
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
    const existing = await this.knex(this.table)
      .where({ key: record.key, tenant_id: tenantId })
      .first();
    if (existing) {
      await this.knex(this.table).where({ id: existing.id }).update(data);
      return;
    }
    await this.knex(this.table).insert({
      id: globalThis.crypto.randomUUID(),
      ...data,
      created_at: timestamp,
    });
  }

  async markCompleted(
    key: string,
    response: unknown,
    tenantId: string | null = null,
  ): Promise<void> {
    await this.knex(this.table)
      .where({ key, tenant_id: tenantId })
      .update({
        status: 'completed',
        response: JSON.stringify(response ?? null),
        locked_until: null,
        updated_at: this.clock.now().toISOString(),
      });
  }

  async markFailed(key: string, tenantId: string | null = null): Promise<void> {
    await this.knex(this.table)
      .where({ key, tenant_id: tenantId })
      .update({ status: 'failed', locked_until: null, updated_at: this.clock.now().toISOString() });
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
