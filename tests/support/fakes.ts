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

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private id(key: string, tenantId?: string | null): string {
    return `${tenantId ?? ''}::${key}`;
  }

  async find(key: string, tenantId?: string | null): Promise<IdempotencyRecord | null> {
    return this.records.get(this.id(key, tenantId)) ?? null;
  }

  async put(record: IdempotencyRecord, tenantId?: string | null): Promise<void> {
    this.records.set(this.id(record.key, tenantId), record);
  }

  async markCompleted(key: string, response: unknown, tenantId?: string | null): Promise<void> {
    const id = this.id(key, tenantId);
    const record = this.records.get(id);
    if (record) {
      this.records.set(id, { ...record, status: 'completed', response, lockedUntil: null });
    }
  }

  async markFailed(key: string, tenantId?: string | null): Promise<void> {
    const id = this.id(key, tenantId);
    const record = this.records.get(id);
    if (record) {
      this.records.set(id, { ...record, status: 'failed', lockedUntil: null });
    }
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLog[] = [];
  private sequence = 0;

  constructor(private readonly clock: Clock) {}

  async create(data: NewAuditLog): Promise<AuditLog> {
    this.sequence += 1;
    const entry: AuditLog = { id: `audit_${this.sequence}`, createdAt: this.clock.now(), ...data };
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
      return true;
    });
    return query.limit ? matches.slice(0, query.limit) : matches;
  }
}
