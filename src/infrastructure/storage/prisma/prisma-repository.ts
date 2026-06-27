import type { Clock } from '../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../domain/contracts/list-options.contract';
import { stripUndefined } from './mappers/shared';
import type { PrismaDelegate } from './prisma-client.types';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export abstract class PrismaRepository<Entity, New, Row> {
  constructor(
    protected readonly delegate: PrismaDelegate<Row>,
    protected readonly clock: Clock,
  ) {}

  async create(data: New): Promise<Entity> {
    const now = this.clock.now();
    const id = globalThis.crypto.randomUUID();
    const row = await this.delegate.create({
      data: stripUndefined({ id, ...this.toRow(data), createdAt: now, updatedAt: now }),
    });
    return this.toEntity(row);
  }

  async createMany(data: New[]): Promise<void> {
    if (data.length === 0) {
      return;
    }
    const now = this.clock.now();
    const rows = data.map((item) =>
      stripUndefined({
        id: globalThis.crypto.randomUUID(),
        ...this.toRow(item),
        createdAt: now,
        updatedAt: now,
      }),
    );
    await this.delegate.createMany({ data: rows });
  }

  async update(id: string, patch: Partial<New>, tenantId?: string | null): Promise<Entity> {
    await this.delegate.updateMany({
      where: this.scopedWhere(id, tenantId),
      data: stripUndefined({ ...this.toRow(patch), updatedAt: this.clock.now() }),
    });
    return this.findByIdOrFail(id, tenantId);
  }

  async findById(id: string, tenantId?: string | null): Promise<Entity | null> {
    return this.firstWhere(this.scopedWhere(id, tenantId));
  }

  async findByIdForUpdate(id: string, tenantId?: string | null): Promise<Entity | null> {
    return this.findById(id, tenantId);
  }

  protected scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined || tenantId === null ? { id } : { id, tenantId };
  }

  protected tenantClause(tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined || tenantId === null ? {} : { tenantId };
  }

  protected async firstWhere(where: Record<string, unknown>): Promise<Entity | null> {
    const row = await this.delegate.findFirst({ where });
    return row ? this.toEntity(row) : null;
  }

  protected async manyWhere(
    where: Record<string, unknown>,
    options: ListOptions = {},
  ): Promise<Entity[]> {
    const filter = options.before
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: options.before.createdAt } },
                { createdAt: options.before.createdAt, id: { lt: options.before.id } },
              ],
            },
          ],
        }
      : where;
    const requested = options.limit ?? DEFAULT_LIST_LIMIT;
    const safe =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIST_LIMIT;
    const limit = Math.min(safe, MAX_LIST_LIMIT);
    const rows = await this.delegate.findMany({
      where: filter,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  protected async findByIdOrFail(id: string, tenantId?: string | null): Promise<Entity> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`${this.constructor.name}: row ${id} missing after write`);
    }
    return found;
  }

  protected abstract toEntity(row: Row): Entity;
  protected abstract toRow(data: Partial<New>): Record<string, unknown>;
}
