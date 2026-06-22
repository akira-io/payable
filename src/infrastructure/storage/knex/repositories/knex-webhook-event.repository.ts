import type { Knex } from 'knex';
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

  constructor(private readonly knex: Knex) {}

  async create(data: NewWebhookEvent): Promise<WebhookEvent> {
    const id = globalThis.crypto.randomUUID();
    await this.knex(this.table).insert({
      id,
      tenant_id: data.tenantId,
      provider: data.provider,
      provider_event_id: data.providerEventId,
      type: data.type,
      payload: data.payload,
      headers: JSON.stringify(data.headers),
      status: data.status,
      correlation_id: data.correlationId,
      received_at: data.receivedAt.toISOString(),
      processed_at: null,
    });
    return this.findByIdOrFail(id);
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    const row = await this.knex(this.table).where({ id }).first();
    return row ? this.toEntity(row) : null;
  }

  async findByProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<WebhookEvent | null> {
    const row = await this.knex(this.table)
      .where({ provider, provider_event_id: providerEventId })
      .first();
    return row ? this.toEntity(row) : null;
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
      tenantId: (row.tenant_id as string | null) ?? null,
      provider: row.provider as string,
      providerEventId: row.provider_event_id as string,
      type: row.type as string,
      payload: row.payload as string,
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
