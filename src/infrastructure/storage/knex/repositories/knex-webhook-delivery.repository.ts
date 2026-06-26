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
import { isUniqueViolation } from '../unique-violation';

export class KnexWebhookDeliveryRepository implements WebhookDeliveryRepository {
  private readonly table = 'payable_webhook_deliveries';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async record(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    const timestamp = this.clock.now().toISOString();
    const match = {
      endpoint_id: data.endpointId,
      event_id: data.eventId,
      tenant_id: data.tenantId ?? null,
    };
    const existing = await this.knex(this.table).where(match).first();
    if (existing) {
      return this.applyUpdate(existing.id as string, data, timestamp);
    }
    const id = globalThis.crypto.randomUUID();
    try {
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
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.knex(this.table).where(match).first();
      if (!raced) {
        throw error;
      }
      return this.applyUpdate(raced.id as string, data, timestamp);
    }
  }

  private async applyUpdate(
    id: string,
    data: NewWebhookDelivery,
    timestamp: string,
  ): Promise<WebhookDelivery> {
    await this.knex(this.table)
      .where({ id })
      .update({
        status: data.status,
        attempts: data.attempts,
        response_code: data.responseCode,
        response_body: data.responseBody,
        payload: JSON.stringify(data.payload),
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
