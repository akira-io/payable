import type { Knex } from 'knex';
import type {
  AuditLogQuery,
  AuditLogRepository,
  NewAuditLog,
} from '../../../../domain/contracts/audit-log-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { auditEntryHash } from '../../../audit/audit-chain';
import { fromJson, toDate, toJson } from '../mappers';

const DEFAULT_AUDIT_LIST_LIMIT = 100;
const MAX_AUDIT_LIST_LIMIT = 1000;

export class KnexAuditLogRepository implements AuditLogRepository {
  private readonly table = 'payable_audit_logs';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(data: NewAuditLog): Promise<AuditLog> {
    const id = globalThis.crypto.randomUUID();
    const previousHash = await this.latestHash(data.tenantId ?? null);
    const hash = await auditEntryHash(previousHash, data);
    const sequence = await this.nextSequence(data.tenantId ?? null);
    await this.knex(this.table).insert({
      id,
      sequence,
      tenant_id: data.tenantId,
      correlation_id: data.correlationId,
      actor_type: data.actorType,
      actor_id: data.actorId,
      action: data.action,
      resource_type: data.resourceType,
      resource_id: data.resourceId,
      before: fromJson(data.before) ?? null,
      after: fromJson(data.after) ?? null,
      metadata: fromJson(data.metadata) ?? null,
      ip_address: data.ipAddress,
      user_agent: data.userAgent,
      previous_hash: previousHash,
      hash,
      created_at: this.clock.now().toISOString(),
    });
    const row = await this.knex(this.table).where({ id }).first();
    return this.toEntity(row as Record<string, unknown>);
  }

  private async latestHash(tenantId: string | null): Promise<string | null> {
    const query = this.knex(this.table).orderBy('sequence', 'desc');
    const scoped =
      tenantId === null ? query.whereNull('tenant_id') : query.where({ tenant_id: tenantId });
    const row = await scoped.first();
    return row ? ((row.hash as string | null) ?? null) : null;
  }

  private async nextSequence(tenantId: string | null): Promise<number> {
    const query = this.knex(this.table);
    const scoped =
      tenantId === null ? query.whereNull('tenant_id') : query.where({ tenant_id: tenantId });
    const row = await scoped.max('sequence as max').first();
    return ((row?.max as number | null) ?? 0) + 1;
  }

  async list(query: AuditLogQuery): Promise<AuditLog[]> {
    let builder = this.knex(this.table).orderBy('sequence', 'desc');
    if (query.tenantId !== undefined) {
      builder = builder.where('tenant_id', query.tenantId);
    }
    if (query.resourceType) {
      builder = builder.where('resource_type', query.resourceType);
    }
    if (query.resourceId) {
      builder = builder.where('resource_id', query.resourceId);
    }
    if (query.correlationId) {
      builder = builder.where('correlation_id', query.correlationId);
    }
    const limit = Math.min(query.limit ?? DEFAULT_AUDIT_LIST_LIMIT, MAX_AUDIT_LIST_LIMIT);
    builder = builder.limit(limit);
    const rows = (await builder) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: Record<string, unknown>): AuditLog {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      correlationId: row.correlation_id as string,
      actorType: (row.actor_type as string | null) ?? null,
      actorId: (row.actor_id as string | null) ?? null,
      action: row.action as string,
      resourceType: row.resource_type as string,
      resourceId: row.resource_id as string,
      before: toJson(row.before),
      after: toJson(row.after),
      metadata: toJson(row.metadata),
      ipAddress: (row.ip_address as string | null) ?? null,
      userAgent: (row.user_agent as string | null) ?? null,
      previousHash: (row.previous_hash as string | null) ?? null,
      hash: row.hash as string,
      createdAt: toDate(row.created_at),
    };
  }
}
