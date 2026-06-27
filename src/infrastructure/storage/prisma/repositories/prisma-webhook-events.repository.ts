import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { Encryption } from '../../../../domain/contracts/encryption.contract';
import type {
  ClaimOptions,
  NewWebhookEvent,
  WebhookEventQuery,
  WebhookEventRepository,
} from '../../../../domain/contracts/webhook-event-repository.contract';
import type {
  WebhookEvent,
  WebhookEventStatus,
} from '../../../../domain/entities/webhook-event.entity';
import { tenant } from '../mappers/shared';
import { webhookEventToEntity } from '../mappers/webhook-event.mapper';
import type { PrismaClient, PrismaDelegate, PrismaWebhookEventRow } from '../prisma-client.types';

const CLAIM_TTL_MS = 300_000;
const DEFAULT_WEBHOOK_LIST_LIMIT = 100;
const MAX_WEBHOOK_LIST_LIMIT = 1000;

export class PrismaWebhookEventRepository implements WebhookEventRepository {
  private readonly delegate: PrismaDelegate<PrismaWebhookEventRow>;

  constructor(
    client: PrismaClient,
    private readonly clock: Clock,
    private readonly encryption?: Encryption,
  ) {
    this.delegate = client.payableWebhookEvent;
  }

  async create(data: NewWebhookEvent): Promise<WebhookEvent> {
    const id = globalThis.crypto.randomUUID();
    const row = await this.delegate.create({
      data: {
        id,
        tenantId: tenant(data.tenantId),
        provider: data.provider,
        providerEventId: data.providerEventId,
        type: data.type,
        normalizedType: data.normalizedType,
        payload: await this.seal(data.payload),
        signature: data.signature == null ? null : await this.seal(data.signature),
        data: await this.seal(JSON.stringify(data.data)),
        headers: await this.seal(JSON.stringify(data.headers)),
        status: data.status,
        correlationId: data.correlationId,
        receivedAt: data.receivedAt,
        processedAt: null,
      },
    });
    return this.hydrate(row);
  }

  async list(query: WebhookEventQuery): Promise<WebhookEvent[]> {
    const where: Record<string, unknown> = {};
    if (query.tenantId !== undefined) {
      where.tenantId = tenant(query.tenantId);
    }
    if (query.provider) {
      where.provider = query.provider;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.type) {
      where.type = query.type;
    }
    const limit = Math.min(query.limit ?? DEFAULT_WEBHOOK_LIST_LIMIT, MAX_WEBHOOK_LIST_LIMIT);
    const rows = await this.delegate.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async findById(id: string, tenantId?: string | null): Promise<WebhookEvent | null> {
    const where = tenantId === undefined ? { id } : { id, tenantId: tenant(tenantId) };
    const row = await this.delegate.findFirst({ where });
    return row ? this.hydrate(row) : null;
  }

  async findByProviderEvent(
    provider: string,
    providerEventId: string,
    tenantId: string | null = null,
  ): Promise<WebhookEvent | null> {
    const row = await this.delegate.findFirst({
      where: { provider, providerEventId, tenantId: tenant(tenantId) },
    });
    return row ? this.hydrate(row) : null;
  }

  async claim(
    id: string,
    tenantId?: string | null,
    options?: ClaimOptions,
  ): Promise<string | null> {
    const scope = tenantId === undefined ? { id } : { id, tenantId: tenant(tenantId) };
    const now = this.clock.now();
    const claimedUntil = new Date(now.getTime() + CLAIM_TTL_MS);
    const claimToken = globalThis.crypto.randomUUID();
    const claimable: WebhookEventStatus[] = options?.replay
      ? ['pending', 'failed', 'processed']
      : ['pending', 'failed'];
    const { count } = await this.delegate.updateMany({
      where: {
        ...scope,
        OR: [{ status: { in: claimable } }, { status: 'processing', claimedUntil: { lt: now } }],
      },
      data: { status: 'processing', claimedUntil, claimToken },
    });
    return count > 0 ? claimToken : null;
  }

  async markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
    tenantId?: string | null,
    claimToken?: string | null,
  ): Promise<WebhookEvent | null> {
    const scope = tenantId === undefined ? { id } : { id, tenantId: tenant(tenantId) };
    const where = claimToken != null ? { ...scope, claimToken } : scope;
    const { count } = await this.delegate.updateMany({
      where,
      data: { status, processedAt: processedAt ?? null },
    });
    if (claimToken != null && count === 0) {
      return null;
    }
    return this.findByIdOrFail(id, tenantId);
  }

  private seal(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.encrypt(value) : value;
  }

  private open(value: string): Promise<string> | string {
    return this.encryption ? this.encryption.decrypt(value) : value;
  }

  private async hydrate(row: PrismaWebhookEventRow): Promise<WebhookEvent> {
    return webhookEventToEntity({
      ...row,
      payload: await this.open(row.payload),
      signature: row.signature == null ? null : await this.open(row.signature),
      data: await this.open(row.data),
      headers: await this.open(row.headers),
    });
  }

  private async findByIdOrFail(id: string, tenantId?: string | null): Promise<WebhookEvent> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`payable_webhook_events: row ${id} missing after write`);
    }
    return found;
  }
}
