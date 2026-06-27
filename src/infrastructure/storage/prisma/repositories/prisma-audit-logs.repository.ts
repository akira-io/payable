import type {
  AuditLogQuery,
  AuditLogRepository,
  NewAuditLog,
} from '../../../../domain/contracts/audit-log-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { PayableError } from '../../../../domain/errors/payable-error';
import { auditEntryHash, auditLinkValid } from '../../../audit/audit-chain';
import { auditLogToEntity } from '../mappers/audit-log.mapper';
import { tenant, toJsonString } from '../mappers/shared';
import type { PrismaAuditLogRow, PrismaClient, PrismaDelegate } from '../prisma-client.types';
import { runInTransaction } from '../transaction';
import { isPrismaUniqueViolation } from '../unique-violation';

const DEFAULT_AUDIT_LIST_LIMIT = 100;
const MAX_AUDIT_LIST_LIMIT = 1000;
const MAX_CHAIN_RETRIES = 50;

export class PrismaAuditLogRepository implements AuditLogRepository {
  private readonly delegate: PrismaDelegate<PrismaAuditLogRow>;

  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
    private readonly auditKey?: string,
  ) {
    this.delegate = client.payableAuditLog;
  }

  async create(data: NewAuditLog): Promise<AuditLog> {
    const tenantId = data.tenantId ?? null;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CHAIN_RETRIES; attempt += 1) {
      try {
        return await this.appendEntry(data, tenantId);
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw new PayableError(
      `Audit chain insert exhausted ${MAX_CHAIN_RETRIES} retries under sequence contention`,
      { code: 'AUDIT_CHAIN_CONTENTION', cause: lastError },
    );
  }

  private appendEntry(data: NewAuditLog, tenantId: string | null): Promise<AuditLog> {
    return runInTransaction(this.client, async (tx) => {
      const delegate = tx.payableAuditLog;
      const latest = await this.latest(delegate, tenantId);
      const previousHash = latest?.hash ?? null;
      const sequence = (latest?.sequence ?? 0) + 1;
      const createdAt = this.clock.now();
      const hash = await auditEntryHash(
        previousHash,
        sequence,
        createdAt.toISOString(),
        data,
        this.auditKey,
      );
      const record: PrismaAuditLogRow = {
        id: globalThis.crypto.randomUUID(),
        sequence,
        tenantId: tenant(tenantId),
        correlationId: data.correlationId,
        actorType: data.actorType ?? null,
        actorId: data.actorId ?? null,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        before: toJsonString(data.before) ?? null,
        after: toJsonString(data.after) ?? null,
        metadata: toJsonString(data.metadata) ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        previousHash,
        hash,
        createdAt,
      };
      await delegate.create({ data: { ...record } });
      return auditLogToEntity(record);
    });
  }

  async verifyChain(tenantId: string | null): Promise<boolean> {
    let previousHash: string | null = null;
    let afterSequence = 0;
    let rows = await this.chainPage(tenantId, afterSequence);
    while (rows.length > 0) {
      for (const row of rows) {
        const entry = auditLogToEntity(row);
        const sequence = row.sequence ?? 0;
        if (!(await auditLinkValid(previousHash, sequence, entry, this.auditKey))) {
          return false;
        }
        previousHash = entry.hash;
        afterSequence = sequence;
      }
      rows =
        rows.length < MAX_AUDIT_LIST_LIMIT ? [] : await this.chainPage(tenantId, afterSequence);
    }
    return true;
  }

  async backfillChain(tenantId: string | null): Promise<number> {
    return runInTransaction(this.client, async (tx) => {
      const delegate = tx.payableAuditLog;
      const legacy = await delegate.findMany({
        where: { tenantId: tenant(tenantId), sequence: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (legacy.length === 0) {
        return 0;
      }
      const latest = await this.latest(delegate, tenantId);
      let previousHash = latest?.hash ?? null;
      let sequence = latest?.sequence ?? 0;
      for (const row of legacy) {
        sequence += 1;
        const entry = auditLogToEntity(row);
        const hash = await auditEntryHash(
          previousHash,
          sequence,
          entry.createdAt.toISOString(),
          entry,
          this.auditKey,
        );
        await delegate.updateMany({
          where: { id: entry.id },
          data: { sequence, previousHash, hash },
        });
        previousHash = hash;
      }
      return legacy.length;
    });
  }

  private chainPage(tenantId: string | null, afterSequence: number): Promise<PrismaAuditLogRow[]> {
    return this.delegate.findMany({
      where: { tenantId: tenant(tenantId), sequence: { gt: afterSequence } },
      orderBy: { sequence: 'asc' },
      take: MAX_AUDIT_LIST_LIMIT,
    });
  }

  private async latest(
    delegate: PrismaDelegate<PrismaAuditLogRow>,
    tenantId: string | null,
  ): Promise<{ hash: string | null; sequence: number } | null> {
    const row = await delegate.findFirst({
      where: { tenantId: tenant(tenantId), sequence: { not: null } },
      orderBy: { sequence: 'desc' },
    });
    if (!row) {
      return null;
    }
    return { hash: row.hash ?? null, sequence: row.sequence ?? 0 };
  }

  async list(query: AuditLogQuery): Promise<AuditLog[]> {
    const where: Record<string, unknown> = {};
    if (query.tenantId !== undefined) {
      where.tenantId = tenant(query.tenantId);
    }
    if (query.resourceType) {
      where.resourceType = query.resourceType;
    }
    if (query.resourceId) {
      where.resourceId = query.resourceId;
    }
    if (query.correlationId) {
      where.correlationId = query.correlationId;
    }
    const limit = Math.min(query.limit ?? DEFAULT_AUDIT_LIST_LIMIT, MAX_AUDIT_LIST_LIMIT);
    const rows = await this.delegate.findMany({
      where,
      orderBy: { sequence: 'desc' },
      take: limit,
    });
    return rows.map((row) => auditLogToEntity(row));
  }
}
