import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { Encryption } from '../../../../domain/contracts/encryption.contract';
import type {
  NewWebhookEndpoint,
  WebhookEndpointRepository,
} from '../../../../domain/contracts/webhook-endpoint-repository.contract';
import type {
  WebhookEndpoint,
  WebhookEndpointStatus,
} from '../../../../domain/entities/webhook-endpoint.entity';
import { toDate } from '../mappers';

export class KnexWebhookEndpointRepository implements WebhookEndpointRepository {
  private readonly table = 'payable_webhook_endpoints';
  private readonly eventsTable = 'payable_webhook_endpoint_events';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
    private readonly encryption?: Encryption,
  ) {}

  async create(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    const secret = await this.seal(data.secret);
    await this.knex.transaction(async (trx) => {
      await trx(this.table).insert({
        id,
        tenant_id: data.tenantId,
        url: data.url,
        events: JSON.stringify(data.events),
        secret,
        status: data.status,
        created_at: timestamp,
        updated_at: timestamp,
      });
      for (const eventType of data.events) {
        await trx(this.eventsTable)
          .insert({ endpoint_id: id, event_type: eventType })
          .onConflict(['endpoint_id', 'event_type'])
          .ignore();
      }
    });
    return this.findByIdOrFail(id, data.tenantId);
  }

  async findById(id: string, tenantId?: string | null): Promise<WebhookEndpoint | null> {
    const row = await this.knex(this.table).where(this.scopedWhere(id, tenantId)).first();
    return row ? this.hydrate(row) : null;
  }

  async list(tenantId?: string | null): Promise<WebhookEndpoint[]> {
    const rows = (await this.knex(this.table)
      .where(this.tenantClause(tenantId))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')) as Record<string, unknown>[];
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async listEnabledForEvent(
    eventType: string,
    tenantId?: string | null,
  ): Promise<WebhookEndpoint[]> {
    let query = this.knex(`${this.table} as ep`)
      .join(`${this.eventsTable} as ev`, 'ev.endpoint_id', 'ep.id')
      .where('ev.event_type', eventType)
      .where('ep.status', 'enabled');
    if (tenantId !== undefined) {
      query = query.where({ 'ep.tenant_id': tenantId });
    }
    const rows = (await query
      .select('ep.*')
      .orderBy('ep.created_at', 'asc')
      .orderBy('ep.id', 'asc')) as Record<string, unknown>[];
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async setStatus(
    id: string,
    status: WebhookEndpointStatus,
    tenantId?: string | null,
  ): Promise<WebhookEndpoint> {
    await this.knex(this.table)
      .where(this.scopedWhere(id, tenantId))
      .update({ status, updated_at: this.clock.now().toISOString() });
    return this.findByIdOrFail(id, tenantId);
  }

  private scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined ? { id } : { id, ...this.tenantClause(tenantId) };
  }

  private tenantClause(tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined ? {} : { tenant_id: tenantId };
  }

  private seal(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.encrypt(value) : value;
  }

  private open(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.decrypt(value) : value;
  }

  private async findByIdOrFail(id: string, tenantId?: string | null): Promise<WebhookEndpoint> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return found;
  }

  private async hydrate(row: Record<string, unknown>): Promise<WebhookEndpoint> {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      url: row.url as string,
      events: this.parseEvents(row.events),
      secret: await this.open(row.secret as string),
      status: row.status as WebhookEndpointStatus,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  private parseEvents(value: unknown): string[] {
    if (typeof value !== 'string') {
      return [];
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
}
