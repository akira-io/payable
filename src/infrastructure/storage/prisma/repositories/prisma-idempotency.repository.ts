import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../../../domain/contracts/idempotency-store.contract';
import { idempotencyToRecord } from '../mappers/idempotency.mapper';
import { tenant } from '../mappers/shared';
import type { PrismaClient, PrismaDelegate, PrismaIdempotencyKeyRow } from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaIdempotencyRepository implements IdempotencyStore {
  private readonly delegate: PrismaDelegate<PrismaIdempotencyKeyRow>;

  constructor(
    client: PrismaClient,
    private readonly clock: Clock,
  ) {
    this.delegate = client.payableIdempotencyKey;
  }

  async find(key: string, tenantId: string | null = null): Promise<IdempotencyRecord | null> {
    const row = await this.delegate.findFirst({ where: { key, tenantId: tenant(tenantId) } });
    return row ? idempotencyToRecord(row) : null;
  }

  async acquire(record: IdempotencyRecord, tenantId: string | null = null): Promise<boolean> {
    const now = this.clock.now();
    try {
      await this.delegate.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          tenantId: tenant(tenantId),
          createdAt: now,
          ...this.row(record, now),
        },
      });
      return true;
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async takeOver(record: IdempotencyRecord, tenantId: string | null = null): Promise<boolean> {
    const now = this.clock.now();
    const { count } = await this.delegate.updateMany({
      where: {
        key: record.key,
        tenantId: tenant(tenantId),
        OR: [
          {
            status: { in: ['processing', 'failed'] },
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
          },
          { expiresAt: { not: null, lt: now } },
        ],
      },
      data: {
        status: 'processing',
        requestHash: record.requestHash,
        response: null,
        lockedUntil: record.lockedUntil ?? null,
        lockToken: record.lockToken ?? null,
        updatedAt: now,
      },
    });
    return count > 0;
  }

  async put(record: IdempotencyRecord, tenantId: string | null = null): Promise<void> {
    const now = this.clock.now();
    await this.delegate.upsert({
      where: { tenantId_key: { tenantId: tenant(tenantId), key: record.key } },
      create: {
        id: globalThis.crypto.randomUUID(),
        tenantId: tenant(tenantId),
        createdAt: now,
        ...this.row(record, now),
      },
      update: this.row(record, now),
    });
  }

  async markCompleted(
    key: string,
    response: unknown,
    tenantId: string | null = null,
    lockToken: string | null = null,
    expiresAt: Date | null = null,
  ): Promise<void> {
    await this.delegate.updateMany({
      where: this.scopedToOwner(key, tenantId, lockToken),
      data: {
        status: 'completed',
        response: JSON.stringify(response ?? null),
        lockedUntil: null,
        expiresAt: expiresAt ?? null,
        updatedAt: this.clock.now(),
      },
    });
  }

  async markFailed(
    key: string,
    tenantId: string | null = null,
    lockToken: string | null = null,
    expiresAt: Date | null = null,
  ): Promise<void> {
    await this.delegate.updateMany({
      where: this.scopedToOwner(key, tenantId, lockToken),
      data: {
        status: 'failed',
        lockedUntil: null,
        expiresAt: expiresAt ?? null,
        updatedAt: this.clock.now(),
      },
    });
  }

  private scopedToOwner(
    key: string,
    tenantId: string | null,
    lockToken: string | null,
  ): Record<string, unknown> {
    const base = { key, tenantId: tenant(tenantId) };
    return lockToken === null ? base : { ...base, lockToken };
  }

  private row(record: IdempotencyRecord, now: Date): Record<string, unknown> {
    return {
      key: record.key,
      scope: record.scope,
      operation: record.operation,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      requestHash: record.requestHash,
      response:
        record.response === undefined || record.response === null
          ? null
          : JSON.stringify(record.response),
      status: record.status,
      lockedUntil: record.lockedUntil ?? null,
      lockToken: record.lockToken ?? null,
      expiresAt: record.expiresAt ?? null,
      updatedAt: now,
    };
  }
}
