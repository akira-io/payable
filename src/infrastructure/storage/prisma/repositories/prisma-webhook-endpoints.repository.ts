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
import { webhookEndpointToEntity } from '../mappers/webhook-endpoint.mapper';
import type {
  PrismaClient,
  PrismaDelegate,
  PrismaWebhookEndpointRow,
} from '../prisma-client.types';
import { runInTransaction } from '../transaction';

const MAX_ENDPOINT_LIST = 1000;

export class PrismaWebhookEndpointRepository implements WebhookEndpointRepository {
  private readonly delegate: PrismaDelegate<PrismaWebhookEndpointRow>;

  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
    private readonly encryption?: Encryption,
  ) {
    this.delegate = client.payableWebhookEndpoint;
  }

  async create(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
    const id = globalThis.crypto.randomUUID();
    const now = this.clock.now();
    const secret = await this.seal(data.secret);
    await runInTransaction(this.client, async (tx) => {
      await tx.payableWebhookEndpoint.create({
        data: {
          id,
          tenantId: data.tenantId,
          url: data.url,
          events: JSON.stringify(data.events),
          secret,
          status: data.status,
          createdAt: now,
          updatedAt: now,
        },
      });
      for (const eventType of data.events) {
        await tx.payableWebhookEndpointEvent.upsert({
          where: { endpointId_eventType: { endpointId: id, eventType } },
          create: { endpointId: id, eventType },
          update: {},
        });
      }
    });
    return this.findByIdOrFail(id, data.tenantId);
  }

  async findById(id: string, tenantId?: string | null): Promise<WebhookEndpoint | null> {
    const row = await this.delegate.findFirst({ where: this.scopedWhere(id, tenantId) });
    return row ? this.hydrate(row) : null;
  }

  async list(tenantId?: string | null): Promise<WebhookEndpoint[]> {
    const rows = await this.delegate.findMany({
      where: this.tenantClause(tenantId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ENDPOINT_LIST,
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async listEnabledForEvent(
    eventType: string,
    tenantId?: string | null,
  ): Promise<WebhookEndpoint[]> {
    const where: Record<string, unknown> = {
      status: 'enabled',
      eventLinks: { some: { eventType } },
    };
    if (tenantId !== undefined) {
      where.tenantId = tenantId;
    }
    const rows = await this.delegate.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async setStatus(
    id: string,
    status: WebhookEndpointStatus,
    tenantId?: string | null,
  ): Promise<WebhookEndpoint> {
    await this.delegate.updateMany({
      where: this.scopedWhere(id, tenantId),
      data: { status, updatedAt: this.clock.now() },
    });
    return this.findByIdOrFail(id, tenantId);
  }

  private scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined ? { id } : { id, ...this.tenantClause(tenantId) };
  }

  private tenantClause(tenantId?: string | null): Record<string, unknown> {
    return tenantId === undefined ? {} : { tenantId };
  }

  private seal(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.encrypt(value) : value;
  }

  private open(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.decrypt(value) : value;
  }

  private async hydrate(row: PrismaWebhookEndpointRow): Promise<WebhookEndpoint> {
    const secret = row.secret == null ? '' : await this.open(row.secret);
    return webhookEndpointToEntity(row, secret);
  }

  private async findByIdOrFail(id: string, tenantId?: string | null): Promise<WebhookEndpoint> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`payable_webhook_endpoints: row ${id} missing after write`);
    }
    return found;
  }
}
