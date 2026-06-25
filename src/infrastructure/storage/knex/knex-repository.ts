import type { Knex } from 'knex';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type { ListOptions } from '../../../domain/contracts/list-options.contract';
import { stripUndefined } from './mappers';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export abstract class KnexRepository<Entity, New> {
  protected abstract readonly table: string;

  constructor(
    protected readonly knex: Knex,
    protected readonly clock: Clock,
  ) {}

  async create(data: New): Promise<Entity> {
    const timestamp = this.clock.now().toISOString();
    const id = globalThis.crypto.randomUUID();
    const [inserted] = await this.knex(this.table)
      .insert(
        stripUndefined({ id, ...this.toRow(data), created_at: timestamp, updated_at: timestamp }),
      )
      .returning('*');
    return inserted ? this.toEntity(inserted as Record<string, unknown>) : this.findByIdOrFail(id);
  }

  async createMany(data: New[]): Promise<void> {
    if (data.length === 0) {
      return;
    }
    const timestamp = this.clock.now().toISOString();
    const rows = data.map((item) =>
      stripUndefined({
        id: globalThis.crypto.randomUUID(),
        ...this.toRow(item),
        created_at: timestamp,
        updated_at: timestamp,
      }),
    );
    await this.knex(this.table).insert(rows);
  }

  async update(id: string, patch: Partial<New>, tenantId?: string | null): Promise<Entity> {
    const [updated] = await this.knex(this.table)
      .where(this.scopedWhere(id, tenantId))
      .update(stripUndefined({ ...this.toRow(patch), updated_at: this.clock.now().toISOString() }))
      .returning('*');
    return updated
      ? this.toEntity(updated as Record<string, unknown>)
      : this.findByIdOrFail(id, tenantId);
  }

  async findById(id: string, tenantId?: string | null): Promise<Entity | null> {
    return this.firstWhere(this.scopedWhere(id, tenantId));
  }

  async findByIdForUpdate(id: string, tenantId?: string | null): Promise<Entity | null> {
    const query = this.knex(this.table).where(this.scopedWhere(id, tenantId));
    if (this.supportsRowLocking()) {
      query.forUpdate();
    }
    const row = await query.first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  protected supportsRowLocking(): boolean {
    const dialect = (this.knex.client as { dialect?: string }).dialect;
    return dialect === 'postgresql' || dialect === 'mysql' || dialect === 'mariadb';
  }

  protected scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined || tenantId === null ? { id } : { id, tenant_id: tenantId };
  }

  protected tenantClause(tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined || tenantId === null ? {} : { tenant_id: tenantId };
  }

  protected async firstWhere(where: Record<string, unknown>): Promise<Entity | null> {
    const row = await this.knex(this.table).where(where).first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  protected async manyWhere(
    where: Record<string, unknown>,
    options: ListOptions = {},
  ): Promise<Entity[]> {
    let query = this.knex(this.table)
      .where(where)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (options.before) {
      const cursorAt = options.before.createdAt.toISOString();
      const cursorId = options.before.id;
      query = query.where((builder) =>
        builder
          .where('created_at', '<', cursorAt)
          .orWhere((tie) => tie.where('created_at', cursorAt).andWhere('id', '<', cursorId)),
      );
    }
    const requested = options.limit ?? DEFAULT_LIST_LIMIT;
    const safe =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIST_LIMIT;
    const limit = Math.min(safe, MAX_LIST_LIMIT);
    const rows = (await query.limit(limit)) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  protected async findByIdOrFail(id: string, tenantId?: string | null): Promise<Entity> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return found;
  }

  protected abstract toEntity(row: Record<string, unknown>): Entity;
  protected abstract toRow(data: Partial<New>): Record<string, unknown>;
}
