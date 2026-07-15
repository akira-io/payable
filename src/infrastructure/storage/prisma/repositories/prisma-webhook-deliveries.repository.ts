import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { Encryption } from '../../../../domain/contracts/encryption.contract';
import type {
  NewWebhookDelivery,
  WebhookDeliveryRepository,
} from '../../../../domain/contracts/webhook-delivery-repository.contract';
import type { WebhookDelivery } from '../../../../domain/entities/webhook-delivery.entity';
import { webhookDeliveryToEntity } from '../mappers/webhook-delivery.mapper';
import type {
  PrismaClient,
  PrismaDelegate,
  PrismaWebhookDeliveryRow,
} from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaWebhookDeliveryRepository implements WebhookDeliveryRepository {
  private readonly delegate: PrismaDelegate<PrismaWebhookDeliveryRow>;

  constructor(
    client: PrismaClient,
    private readonly clock: Clock,
    private readonly encryption?: Encryption,
  ) {
    this.delegate = client.payableWebhookDelivery;
  }

  async record(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    const now = this.clock.now();
    const match = {
      endpointId: data.endpointId,
      eventId: data.eventId,
      tenantId: data.tenantId ?? null,
    };
    const existing = await this.delegate.findFirst({ where: match });
    if (existing) {
      return this.applyUpdate(existing.id, data, now);
    }
    const id = globalThis.crypto.randomUUID();
    try {
      const row = await this.delegate.create({
        data: {
          id,
          tenantId: data.tenantId,
          endpointId: data.endpointId,
          eventId: data.eventId,
          eventType: data.eventType,
          payload: await this.seal(JSON.stringify(data.payload)),
          status: data.status,
          attempts: data.attempts,
          responseCode: data.responseCode,
          responseBody: data.responseBody,
          nextRetryAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return this.hydrate(row);
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.delegate.findFirst({ where: match });
      if (!raced) {
        throw error;
      }
      return this.applyUpdate(raced.id, data, now);
    }
  }

  private async applyUpdate(
    id: string,
    data: NewWebhookDelivery,
    now: Date,
  ): Promise<WebhookDelivery> {
    await this.delegate.updateMany({
      where: { id },
      data: {
        status: data.status,
        attempts: data.attempts,
        responseCode: data.responseCode,
        responseBody: data.responseBody,
        payload: await this.seal(JSON.stringify(data.payload)),
        updatedAt: now,
      },
    });
    return this.findByIdOrFail(id);
  }

  async listForEvent(eventId: string, tenantId?: string | null): Promise<WebhookDelivery[]> {
    const where = tenantId === undefined ? { eventId } : { eventId, tenantId };
    const rows = await this.delegate.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  private async findByIdOrFail(id: string): Promise<WebhookDelivery> {
    const row = await this.delegate.findFirst({ where: { id } });
    if (!row) {
      throw new Error(`payable_webhook_deliveries: row ${id} missing after write`);
    }
    return this.hydrate(row);
  }

  private async hydrate(row: PrismaWebhookDeliveryRow): Promise<WebhookDelivery> {
    return webhookDeliveryToEntity({ ...row, payload: await this.open(row.payload) });
  }

  private seal(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.encrypt(value) : value;
  }

  private open(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.decrypt(value) : value;
  }
}
