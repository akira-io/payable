import type {
  AuditLogQuery,
  AuditLogRepository,
  NewAuditLog,
} from '../../src/domain/contracts/audit-log-repository.contract';
import type { Clock } from '../../src/domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../src/domain/contracts/idempotency-store.contract';
import type { AuditLog } from '../../src/domain/entities/audit-log.entity';
import { auditEntryHash } from '../../src/infrastructure/audit/audit-chain';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private id(key: string, tenantId?: string | null): string {
    return `${tenantId ?? ''}::${key}`;
  }

  async find(key: string, tenantId?: string | null): Promise<IdempotencyRecord | null> {
    return this.records.get(this.id(key, tenantId)) ?? null;
  }

  async acquire(record: IdempotencyRecord, tenantId?: string | null): Promise<boolean> {
    const id = this.id(record.key, tenantId);
    if (this.records.has(id)) {
      return false;
    }
    this.records.set(id, record);
    return true;
  }

  async takeOver(record: IdempotencyRecord, tenantId?: string | null): Promise<boolean> {
    const id = this.id(record.key, tenantId);
    const existing = this.records.get(id);
    if (!existing || existing.status === 'completed') {
      return false;
    }
    this.records.set(id, record);
    return true;
  }

  async put(record: IdempotencyRecord, tenantId?: string | null): Promise<void> {
    this.records.set(this.id(record.key, tenantId), record);
  }

  async markCompleted(
    key: string,
    response: unknown,
    tenantId?: string | null,
    lockToken?: string | null,
  ): Promise<void> {
    const id = this.id(key, tenantId);
    const record = this.records.get(id);
    if (record && this.owns(record, lockToken)) {
      this.records.set(id, { ...record, status: 'completed', response, lockedUntil: null });
    }
  }

  async markFailed(
    key: string,
    tenantId?: string | null,
    lockToken?: string | null,
  ): Promise<void> {
    const id = this.id(key, tenantId);
    const record = this.records.get(id);
    if (record && this.owns(record, lockToken)) {
      this.records.set(id, { ...record, status: 'failed', lockedUntil: null });
    }
  }

  private owns(record: IdempotencyRecord, lockToken?: string | null): boolean {
    return lockToken === undefined || lockToken === null || record.lockToken === lockToken;
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLog[] = [];
  private sequence = 0;

  constructor(private readonly clock: Clock) {}

  async create(data: NewAuditLog): Promise<AuditLog> {
    this.sequence += 1;
    const previousHash =
      [...this.entries].reverse().find((e) => (e.tenantId ?? null) === (data.tenantId ?? null))
        ?.hash ?? null;
    const hash = await auditEntryHash(previousHash, data);
    const entry: AuditLog = {
      id: `audit_${this.sequence}`,
      createdAt: this.clock.now(),
      previousHash,
      hash,
      ...data,
    };
    this.entries.push(entry);
    return entry;
  }

  async list(query: AuditLogQuery): Promise<AuditLog[]> {
    const matches = this.entries.filter((entry) => {
      if (query.resourceType && entry.resourceType !== query.resourceType) {
        return false;
      }
      if (query.resourceId && entry.resourceId !== query.resourceId) {
        return false;
      }
      if (query.correlationId && entry.correlationId !== query.correlationId) {
        return false;
      }
      if (query.tenantId !== undefined && (entry.tenantId ?? null) !== (query.tenantId ?? null)) {
        return false;
      }
      return true;
    });
    const ordered = matches.slice().reverse();
    return query.limit ? ordered.slice(0, query.limit) : ordered;
  }
}
