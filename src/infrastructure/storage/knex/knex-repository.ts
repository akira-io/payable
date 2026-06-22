import type { Knex } from 'knex';
import type { Clock } from '../../../domain/contracts/clock.contract';
import { stripUndefined } from './mappers';

export abstract class KnexRepository<Entity, New> {
  protected abstract readonly table: string;

  constructor(
    protected readonly knex: Knex,
    protected readonly clock: Clock,
  ) {}

  async create(data: New): Promise<Entity> {
    const timestamp = this.clock.now().toISOString();
    const id = globalThis.crypto.randomUUID();
    await this.knex(this.table).insert(
      stripUndefined({ id, ...this.toRow(data), created_at: timestamp, updated_at: timestamp }),
    );
    return this.findByIdOrFail(id);
  }

  async update(id: string, patch: Partial<New>): Promise<Entity> {
    await this.knex(this.table)
      .where({ id })
      .update(stripUndefined({ ...this.toRow(patch), updated_at: this.clock.now().toISOString() }));
    return this.findByIdOrFail(id);
  }

  async findById(id: string): Promise<Entity | null> {
    return this.firstWhere({ id });
  }

  protected async firstWhere(where: Record<string, unknown>): Promise<Entity | null> {
    const row = await this.knex(this.table).where(where).first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  protected async manyWhere(where: Record<string, unknown>, limit?: number): Promise<Entity[]> {
    const query = this.knex(this.table).where(where);
    const rows = (await (limit ? query.limit(limit) : query)) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  protected async findByIdOrFail(id: string): Promise<Entity> {
    const found = await this.findById(id);
    if (!found) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return found;
  }

  protected abstract toEntity(row: Record<string, unknown>): Entity;
  protected abstract toRow(data: Partial<New>): Record<string, unknown>;
}
