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

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
    private readonly encryption?: Encryption,
  ) {}

  async create(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    await this.knex(this.table).insert({
      id,
      tenant_id: data.tenantId,
      url: data.url,
      events: JSON.stringify(data.events),
      secret: await this.seal(data.secret),
      status: data.status,
      created_at: timestamp,
      updated_at: timestamp,
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
    const rows = (await this.knex(this.table)
      .where({ status: 'enabled', ...this.tenantClause(tenantId) })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')) as Record<string, unknown>[];
    const endpoints = await Promise.all(rows.map((row) => this.hydrate(row)));
    return endpoints.filter((endpoint) => endpoint.events.includes(eventType));
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
