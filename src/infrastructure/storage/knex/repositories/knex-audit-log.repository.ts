import type { Knex } from 'knex';
import type {
  AuditLogQuery,
  AuditLogRepository,
  NewAuditLog,
} from '../../../../domain/contracts/audit-log-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { fromJson, toDate, toJson } from '../mappers';

export class KnexAuditLogRepository implements AuditLogRepository {
  private readonly table = 'payable_audit_logs';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(data: NewAuditLog): Promise<AuditLog> {
    const id = globalThis.crypto.randomUUID();
    await this.knex(this.table).insert({
      id,
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
      created_at: this.clock.now().toISOString(),
    });
    const row = await this.knex(this.table).where({ id }).first();
    return this.toEntity(row as Record<string, unknown>);
  }

  async list(query: AuditLogQuery): Promise<AuditLog[]> {
    let builder = this.knex(this.table).orderBy('created_at', 'desc');
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
    if (query.limit) {
      builder = builder.limit(query.limit);
    }
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
      createdAt: toDate(row.created_at),
    };
  }
}
