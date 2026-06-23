import type { Knex } from 'knex';
import type { Encryption } from '../../../../domain/contracts/encryption.contract';
import type {
  NewWebhookEvent,
  WebhookEventRepository,
} from '../../../../domain/contracts/webhook-event-repository.contract';
import type {
  WebhookEvent,
  WebhookEventStatus,
} from '../../../../domain/entities/webhook-event.entity';
import { toDate, toJson, toNullableDate } from '../mappers';

export class KnexWebhookEventRepository implements WebhookEventRepository {
  private readonly table = 'payable_webhook_events';

  constructor(
    private readonly knex: Knex,
    private readonly encryption?: Encryption,
  ) {}

  async create(data: NewWebhookEvent): Promise<WebhookEvent> {
    const id = globalThis.crypto.randomUUID();
    await this.knex(this.table).insert({
      id,
      tenant_id: this.tenant(data.tenantId),
      provider: data.provider,
      provider_event_id: data.providerEventId,
      type: data.type,
      normalized_type: data.normalizedType,
      payload: await this.seal(data.payload),
      data: await this.seal(JSON.stringify(data.data)),
      headers: await this.seal(JSON.stringify(data.headers)),
      status: data.status,
      correlation_id: data.correlationId,
      received_at: data.receivedAt.toISOString(),
      processed_at: null,
    });
    return this.findByIdOrFail(id);
  }

  async findById(id: string, tenantId?: string | null): Promise<WebhookEvent | null> {
    const where = tenantId === undefined ? { id } : { id, tenant_id: this.tenant(tenantId) };
    const row = await this.knex(this.table).where(where).first();
    return row ? this.hydrate(row) : null;
  }

  async findByProviderEvent(
    provider: string,
    providerEventId: string,
    tenantId: string | null = null,
  ): Promise<WebhookEvent | null> {
    const row = await this.knex(this.table)
      .where({ provider, provider_event_id: providerEventId, tenant_id: this.tenant(tenantId) })
      .first();
    return row ? this.hydrate(row) : null;
  }

  private tenant(tenantId: string | null): string {
    return tenantId ?? '';
  }

  private seal(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.encrypt(value) : value;
  }

  private open(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.decrypt(value) : value;
  }

  private async hydrate(row: Record<string, unknown>): Promise<WebhookEvent> {
    return this.toEntity({
      ...row,
      payload: await this.open(row.payload as string),
      data: await this.open(row.data as string),
      headers: await this.open(row.headers as string),
    });
  }

  async claim(id: string, tenantId?: string | null): Promise<boolean> {
    const where = tenantId === undefined ? { id } : { id, tenant_id: this.tenant(tenantId) };
    const affected = await this.knex(this.table)
      .where(where)
      .whereIn('status', ['pending', 'failed'])
      .update({ status: 'processing' });
    return affected > 0;
  }

  async markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
  ): Promise<WebhookEvent> {
    await this.knex(this.table)
      .where({ id })
      .update({ status, processed_at: processedAt ? processedAt.toISOString() : null });
    return this.findByIdOrFail(id);
  }

  private toEntity(row: Record<string, unknown>): WebhookEvent {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string) || null,
      provider: row.provider as string,
      providerEventId: row.provider_event_id as string,
      type: row.type as string,
      normalizedType: (row.normalized_type as string | null) ?? null,
      payload: row.payload as string,
      data: toJson<Record<string, unknown>>(row.data) ?? {},
      headers: toJson<Record<string, string>>(row.headers) ?? {},
      status: row.status as WebhookEventStatus,
      correlationId: row.correlation_id as string,
      receivedAt: toDate(row.received_at),
      processedAt: toNullableDate(row.processed_at),
    };
  }

  private async findByIdOrFail(id: string): Promise<WebhookEvent> {
    const found = await this.findById(id);
    if (!found) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return found;
  }
}
