import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewWebhookDelivery,
  WebhookDeliveryRepository,
} from '../../../../domain/contracts/webhook-delivery-repository.contract';
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../../../../domain/entities/webhook-delivery.entity';
import { toDate, toJson } from '../mappers';

export class KnexWebhookDeliveryRepository implements WebhookDeliveryRepository {
  private readonly table = 'payable_webhook_deliveries';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async record(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    const timestamp = this.clock.now().toISOString();
    const existing = await this.knex(this.table)
      .where({ endpoint_id: data.endpointId, event_id: data.eventId })
      .first();
    if (existing) {
      await this.knex(this.table)
        .where({ id: existing.id })
        .update({
          status: data.status,
          attempts: data.attempts,
          response_code: data.responseCode,
          response_body: data.responseBody,
          payload: JSON.stringify(data.payload),
          updated_at: timestamp,
        });
      return this.findByIdOrFail(existing.id as string);
    }
    const id = globalThis.crypto.randomUUID();
    await this.knex(this.table).insert({
      id,
      tenant_id: data.tenantId,
      endpoint_id: data.endpointId,
      event_id: data.eventId,
      event_type: data.eventType,
      payload: JSON.stringify(data.payload),
      status: data.status,
      attempts: data.attempts,
      response_code: data.responseCode,
      response_body: data.responseBody,
      next_retry_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return this.findByIdOrFail(id);
  }

  async listForEvent(eventId: string, tenantId?: string | null): Promise<WebhookDelivery[]> {
    const clause = tenantId === undefined ? {} : { tenant_id: tenantId };
    const rows = (await this.knex(this.table)
      .where({ event_id: eventId, ...clause })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private async findByIdOrFail(id: string): Promise<WebhookDelivery> {
    const row = await this.knex(this.table).where({ id }).first();
    if (!row) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return this.toEntity(row as Record<string, unknown>);
  }

  private toEntity(row: Record<string, unknown>): WebhookDelivery {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      endpointId: row.endpoint_id as string,
      eventId: row.event_id as string,
      eventType: row.event_type as string,
      payload: toJson<Record<string, unknown>>(row.payload) ?? {},
      status: row.status as WebhookDeliveryStatus,
      attempts: row.attempts as number,
      responseCode: (row.response_code as number | null) ?? null,
      responseBody: (row.response_body as string | null) ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }
}
