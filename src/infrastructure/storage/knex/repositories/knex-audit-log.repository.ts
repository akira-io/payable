import type { Knex } from 'knex';
import type {
  AuditLogQuery,
  AuditLogRepository,
  NewAuditLog,
} from '../../../../domain/contracts/audit-log-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { auditEntryHash, auditLinkValid } from '../../../audit/audit-chain';
import { fromJson, toDate, toJson } from '../mappers';

const DEFAULT_AUDIT_LIST_LIMIT = 100;
const MAX_AUDIT_LIST_LIMIT = 1000;
const MAX_CHAIN_RETRIES = 50;

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  if (
    candidate.code === '23505' ||
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    candidate.code === 'ER_DUP_ENTRY' ||
    candidate.errno === 1062
  ) {
    return true;
  }
  return typeof candidate.message === 'string' && /unique/i.test(candidate.message);
}

export class KnexAuditLogRepository implements AuditLogRepository {
  private readonly table = 'payable_audit_logs';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
    private readonly auditKey?: string,
  ) {}

  async create(data: NewAuditLog): Promise<AuditLog> {
    const tenantId = data.tenantId ?? null;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CHAIN_RETRIES; attempt += 1) {
      try {
        return await this.appendEntry(data, tenantId);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  private appendEntry(data: NewAuditLog, tenantId: string | null): Promise<AuditLog> {
    return this.knex.transaction(async (trx) => {
      const latest = await this.latest(tenantId, trx);
      const previousHash = latest?.hash ?? null;
      const sequence = (latest?.sequence ?? 0) + 1;
      const createdAt = this.clock.now().toISOString();
      const hash = await auditEntryHash(previousHash, sequence, createdAt, data, this.auditKey);
      const record = {
        id: globalThis.crypto.randomUUID(),
        sequence,
        tenant_id: this.tenant(tenantId),
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
        created_at: createdAt,
      };
      await trx(this.table).insert(record);
      return this.toEntity(record as Record<string, unknown>);
    });
  }

  async verifyChain(tenantId: string | null): Promise<boolean> {
    let previousHash: string | null = null;
    let afterSequence = 0;
    let rows = await this.chainPage(tenantId, afterSequence);
    while (rows.length > 0) {
      for (const row of rows) {
        const entry = this.toEntity(row);
        if (!(await auditLinkValid(previousHash, row.sequence as number, entry, this.auditKey))) {
          return false;
        }
        previousHash = entry.hash;
        afterSequence = row.sequence as number;
      }
      rows =
        rows.length < MAX_AUDIT_LIST_LIMIT ? [] : await this.chainPage(tenantId, afterSequence);
    }
    return true;
  }

  private async chainPage(
    tenantId: string | null,
    afterSequence: number,
  ): Promise<Record<string, unknown>[]> {
    return (await this.knex(this.table)
      .where({ tenant_id: this.tenant(tenantId) })
      .andWhere('sequence', '>', afterSequence)
      .orderBy('sequence', 'asc')
      .limit(MAX_AUDIT_LIST_LIMIT)) as Record<string, unknown>[];
  }

  private tenant(tenantId: string | null): string {
    return tenantId ?? '';
  }

  private supportsRowLocking(): boolean {
    const dialect = (this.knex.client as { dialect?: string }).dialect;
    return dialect === 'postgresql' || dialect === 'mysql' || dialect === 'mariadb';
  }

  private async latest(
    tenantId: string | null,
    executor: Knex = this.knex,
  ): Promise<{ hash: string | null; sequence: number } | null> {
    const query = executor(this.table)
      .where({ tenant_id: this.tenant(tenantId) })
      .orderBy('sequence', 'desc');
    if (this.supportsRowLocking()) {
      query.forUpdate();
    }
    const row = await query.first();
    if (!row) {
      return null;
    }
    return { hash: (row.hash as string | null) ?? null, sequence: row.sequence as number };
  }

  async list(query: AuditLogQuery): Promise<AuditLog[]> {
    let builder = this.knex(this.table).orderBy('sequence', 'desc');
    if (query.tenantId !== undefined) {
      builder = builder.where('tenant_id', this.tenant(query.tenantId));
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
      tenantId: (row.tenant_id as string) || null,
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
