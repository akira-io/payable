import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewOutboxEvent,
  OutboxEvent,
  OutboxEventRepository,
  OutboxStatus,
} from '../../../../domain/contracts/outbox-event-repository.contract';
import { toDate, toJson, toNullableDate } from '../mappers';

const CLAIM_TTL_MS = 300_000;

export class KnexOutboxEventRepository implements OutboxEventRepository {
  private readonly table = 'payable_outbox_events';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(data: NewOutboxEvent): Promise<OutboxEvent> {
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    await this.knex(this.table).insert({
      id,
      tenant_id: data.tenantId,
      correlation_id: data.correlationId,
      event_type: data.eventType,
      event_version: data.eventVersion,
      payload: JSON.stringify(data.payload),
      status: 'pending',
      attempts: 0,
      next_retry_at: null,
      locked_by: null,
      locked_until: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    const row = await this.knex(this.table).where({ id }).first();
    return this.toEntity(row as Record<string, unknown>);
  }

  async pullPending(limit: number): Promise<OutboxEvent[]> {
    const now = this.clock.now().toISOString();
    const rows = (await this.knex(this.table)
      .where({ status: 'pending' })
      .where((builder) => builder.whereNull('next_retry_at').orWhere('next_retry_at', '<=', now))
      .orderBy('created_at', 'asc')
      .limit(limit)) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  async claimPending(limit: number): Promise<OutboxEvent[]> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const token = globalThis.crypto.randomUUID();
    const candidates = (await this.knex(this.table)
      .select('id')
      .where((builder) => this.claimable(builder, nowIso))
      .orderBy('created_at', 'asc')
      .limit(limit)) as Record<string, unknown>[];
    const ids = candidates.map((row) => row.id as string);
    if (ids.length === 0) {
      return [];
    }
    const lockedUntil = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
    await this.knex(this.table)
      .whereIn('id', ids)
      .where((builder) => this.claimable(builder, nowIso))
      .update({
        status: 'processing',
        locked_by: token,
        locked_until: lockedUntil,
        updated_at: nowIso,
      });
    const rows = (await this.knex(this.table)
      .where({ locked_by: token, status: 'processing' })
      .orderBy('created_at', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  async markPublished(id: string): Promise<void> {
    await this.knex(this.table).where({ id }).update({
      status: 'published',
      locked_by: null,
      locked_until: null,
      updated_at: this.clock.now().toISOString(),
    });
  }

  async markFailed(id: string, nextRetryAt: Date | null): Promise<void> {
    await this.knex(this.table)
      .where({ id })
      .update({
        status: nextRetryAt ? 'pending' : 'failed',
        attempts: this.knex.raw('attempts + 1'),
        next_retry_at: nextRetryAt ? nextRetryAt.toISOString() : null,
        locked_by: null,
        locked_until: null,
        updated_at: this.clock.now().toISOString(),
      });
  }

  private claimable(builder: Knex.QueryBuilder, nowIso: string): void {
    builder
      .where((pending) =>
        pending
          .where({ status: 'pending' })
          .andWhere((retry) =>
            retry.whereNull('next_retry_at').orWhere('next_retry_at', '<=', nowIso),
          ),
      )
      .orWhere((stale) =>
        stale.where({ status: 'processing' }).andWhere('locked_until', '<=', nowIso),
      );
  }

  private toEntity(row: Record<string, unknown>): OutboxEvent {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      correlationId: row.correlation_id as string,
      eventType: row.event_type as string,
      eventVersion: row.event_version as number,
      payload: toJson<Record<string, unknown>>(row.payload) ?? {},
      status: row.status as OutboxStatus,
      attempts: row.attempts as number,
      nextRetryAt: toNullableDate(row.next_retry_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }
}
