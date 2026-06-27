import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewOutboxEvent,
  OutboxEvent,
  OutboxEventRepository,
} from '../../../../domain/contracts/outbox-event-repository.contract';
import { outboxToEntity } from '../mappers/outbox.mapper';
import type { PrismaClient, PrismaDelegate, PrismaOutboxEventRow } from '../prisma-client.types';
import { runInTransaction } from '../transaction';
import { isPrismaUniqueViolation } from '../unique-violation';

const CLAIM_TTL_MS = 300_000;
const FAIR_OVERFETCH_FACTOR = 5;
const MAX_FAIR_OVERFETCH = 1000;

export class PrismaOutboxEventRepository implements OutboxEventRepository {
  private readonly delegate: PrismaDelegate<PrismaOutboxEventRow>;

  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {
    this.delegate = client.payableOutboxEvent;
  }

  async create(data: NewOutboxEvent): Promise<OutboxEvent> {
    const id = globalThis.crypto.randomUUID();
    const now = this.clock.now();
    const dedupeKey = data.dedupeKey ?? null;
    const tenantId = data.tenantId ?? null;
    const row = {
      id,
      tenantId,
      correlationId: data.correlationId,
      eventType: data.eventType,
      eventVersion: data.eventVersion,
      payload: JSON.stringify(data.payload),
      status: 'pending',
      attempts: 0,
      nextRetryAt: null,
      lockedBy: null,
      lockedUntil: null,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    };
    if (dedupeKey === null) {
      const created = await this.delegate.create({ data: row });
      return outboxToEntity(created);
    }
    const existing = await this.delegate.findFirst({ where: { dedupeKey, tenantId } });
    if (existing) {
      return outboxToEntity(existing);
    }
    try {
      const created = await this.delegate.create({ data: row });
      return outboxToEntity(created);
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.delegate.findFirst({ where: { dedupeKey, tenantId } });
      if (!raced) {
        throw error;
      }
      return outboxToEntity(raced);
    }
  }

  async claimPending(limit: number): Promise<OutboxEvent[]> {
    const now = this.clock.now();
    const token = globalThis.crypto.randomUUID();
    const lockedUntil = new Date(now.getTime() + CLAIM_TTL_MS);
    const fetchLimit = Math.min(limit * FAIR_OVERFETCH_FACTOR, MAX_FAIR_OVERFETCH);
    return runInTransaction(this.client, async (tx) => {
      const delegate = tx.payableOutboxEvent;
      const candidates = await delegate.findMany({
        where: this.claimable(now),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: fetchLimit,
      });
      const ids = this.fairlyOrdered(candidates, limit);
      if (ids.length === 0) {
        return [];
      }
      await delegate.updateMany({
        where: { id: { in: ids }, ...this.claimable(now) },
        data: { status: 'processing', lockedBy: token, lockedUntil, updatedAt: now },
      });
      const rows = await delegate.findMany({
        where: { id: { in: ids }, lockedBy: token, status: 'processing' },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids
        .map((id) => byId.get(id))
        .filter((row): row is PrismaOutboxEventRow => row !== undefined)
        .map((row) => outboxToEntity(row));
    });
  }

  async markPublished(id: string, lockToken: string | null = null): Promise<number> {
    const { count } = await this.delegate.updateMany({
      where: this.owned(id, lockToken),
      data: { status: 'published', lockedBy: null, lockedUntil: null, updatedAt: this.clock.now() },
    });
    return count;
  }

  async markFailed(
    id: string,
    nextRetryAt: Date | null,
    lockToken: string | null = null,
  ): Promise<number> {
    const now = this.clock.now();
    const retry = nextRetryAt !== null && nextRetryAt.getTime() > now.getTime();
    const { count } = await this.delegate.updateMany({
      where: this.owned(id, lockToken),
      data: {
        status: retry ? 'pending' : 'failed',
        attempts: { increment: 1 },
        nextRetryAt: retry ? nextRetryAt : null,
        lockedBy: null,
        lockedUntil: null,
        updatedAt: now,
      },
    });
    return count;
  }

  private owned(id: string, lockToken: string | null): Record<string, unknown> {
    return lockToken === null ? { id } : { id, lockedBy: lockToken };
  }

  private claimable(now: Date): Record<string, unknown> {
    return {
      OR: [
        { status: 'pending', OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        { status: 'processing', lockedUntil: { lte: now } },
      ],
    };
  }

  private fairlyOrdered(candidates: PrismaOutboxEventRow[], limit: number): string[] {
    const queues = new Map<string, string[]>();
    for (const row of candidates) {
      const key = row.tenantId ?? '';
      const bucket = queues.get(key);
      if (bucket) {
        bucket.push(row.id);
      } else {
        queues.set(key, [row.id]);
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
}
