import type { Knex } from 'knex';
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
import { toDate, toJson, toNullableDate } from '../mappers';

const CLAIM_TTL_MS = 300_000;
const DEFAULT_WEBHOOK_LIST_LIMIT = 100;
const MAX_WEBHOOK_LIST_LIMIT = 1000;

export class KnexWebhookEventRepository implements WebhookEventRepository {
  private readonly table = 'payable_webhook_events';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
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

  async list(query: WebhookEventQuery): Promise<WebhookEvent[]> {
    let builder = this.knex(this.table).orderBy('received_at', 'desc').orderBy('id', 'desc');
    if (query.tenantId !== undefined) {
      builder = builder.where('tenant_id', this.tenant(query.tenantId));
    }
    if (query.provider) {
      builder = builder.where('provider', query.provider);
    }
    if (query.status) {
      builder = builder.where('status', query.status);
    }
    if (query.type) {
      builder = builder.where('type', query.type);
    }
    const limit = Math.min(query.limit ?? DEFAULT_WEBHOOK_LIST_LIMIT, MAX_WEBHOOK_LIST_LIMIT);
    const rows = (await builder.limit(limit)) as Record<string, unknown>[];
    return Promise.all(rows.map((row) => this.hydrate(row)));
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

  async claim(
    id: string,
    tenantId?: string | null,
    options?: ClaimOptions,
  ): Promise<string | null> {
    const where = tenantId === undefined ? { id } : { id, tenant_id: this.tenant(tenantId) };
    const now = this.clock.now();
    const claimedUntil = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
    const claimToken = globalThis.crypto.randomUUID();
    const claimable: WebhookEventStatus[] = options?.replay
      ? ['pending', 'failed', 'processed']
      : ['pending', 'failed'];
    const affected = await this.knex(this.table)
      .where(where)
      .where((builder) =>
        builder
          .whereIn('status', claimable)
          .orWhere((stale) =>
            stale.where('status', 'processing').andWhere('claimed_until', '<', now.toISOString()),
          ),
      )
      .update({ status: 'processing', claimed_until: claimedUntil, claim_token: claimToken });
    return affected > 0 ? claimToken : null;
  }

  async markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
    tenantId?: string | null,
    claimToken?: string | null,
  ): Promise<WebhookEvent | null> {
    const where = tenantId === undefined ? { id } : { id, tenant_id: this.tenant(tenantId) };
    let builder = this.knex(this.table).where(where);
    if (claimToken != null) {
      builder = builder.where('claim_token', claimToken);
    }
    const affected = await builder.update({
      status,
      processed_at: processedAt ? processedAt.toISOString() : null,
    });
    if (claimToken != null && affected === 0) {
      return null;
    }
    return this.findByIdOrFail(id, tenantId);
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

  private async findByIdOrFail(id: string, tenantId?: string | null): Promise<WebhookEvent> {
    const found = await this.findById(id, tenantId);
    if (!found) {
      throw new Error(`${this.table}: row ${id} missing after write`);
    }
    return found;
  }
}
