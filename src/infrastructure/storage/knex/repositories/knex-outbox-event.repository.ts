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
const FAIR_OVERFETCH_FACTOR = 5;
const MAX_FAIR_OVERFETCH = 1000;

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

  async claimPending(limit: number): Promise<OutboxEvent[]> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const token = globalThis.crypto.randomUUID();
    const lockedUntil = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
    const fetchLimit = Math.min(limit * FAIR_OVERFETCH_FACTOR, MAX_FAIR_OVERFETCH);
    return this.knex.transaction(async (trx) => {
      const select = trx(this.table)
        .select('id', 'tenant_id')
        .where((builder) => this.claimable(builder, nowIso))
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .limit(fetchLimit);
      if (this.supportsRowLocking()) {
        select.forUpdate().skipLocked();
      }
      const candidates = (await select) as Record<string, unknown>[];
      const ids = this.fairlyOrdered(candidates, limit);
      if (ids.length === 0) {
        return [];
      }
      await trx(this.table)
        .whereIn('id', ids)
        .where((builder) => this.claimable(builder, nowIso))
        .update({
          status: 'processing',
          locked_by: token,
          locked_until: lockedUntil,
          updated_at: nowIso,
        });
      const rows = (await trx(this.table)
        .where({ locked_by: token, status: 'processing' })
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')) as Record<string, unknown>[];
      return rows.map((row) => this.toEntity(row));
    });
  }

  private fairlyOrdered(candidates: Record<string, unknown>[], limit: number): string[] {
    const queues = new Map<string, string[]>();
    for (const row of candidates) {
      const key = (row.tenant_id as string | null) ?? '';
      const bucket = queues.get(key);
      if (bucket) {
        bucket.push(row.id as string);
      } else {
        queues.set(key, [row.id as string]);
      }
    }
    const ordered: string[] = [];
    const buckets = [...queues.values()];
    while (ordered.length < limit) {
      let progressed = false;
      for (const bucket of buckets) {
        if (ordered.length >= limit) {
          break;
        }
        const id = bucket.shift();
        if (id !== undefined) {
          ordered.push(id);
          progressed = true;
        }
      }
      if (!progressed) {
        break;
      }
    }
    return ordered;
  }

  private supportsRowLocking(): boolean {
    const dialect = (this.knex.client as { dialect?: string }).dialect;
    return dialect === 'postgresql' || dialect === 'mysql' || dialect === 'mariadb';
  }

  async markPublished(id: string, lockToken: string | null = null): Promise<number> {
    return this.owned(id, lockToken).update({
      status: 'published',
      locked_by: null,
      locked_until: null,
      updated_at: this.clock.now().toISOString(),
    });
  }

  async markFailed(
    id: string,
    nextRetryAt: Date | null,
    lockToken: string | null = null,
  ): Promise<number> {
    return this.owned(id, lockToken).update({
      status: nextRetryAt ? 'pending' : 'failed',
      attempts: this.knex.raw('attempts + 1'),
      next_retry_at: nextRetryAt ? nextRetryAt.toISOString() : null,
      locked_by: null,
      locked_until: null,
      updated_at: this.clock.now().toISOString(),
    });
  }

  private owned(id: string, lockToken: string | null): Knex.QueryBuilder {
    const query = this.knex(this.table).where({ id });
    return lockToken === null ? query : query.where({ locked_by: lockToken });
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
      lockToken: (row.locked_by as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }
}
