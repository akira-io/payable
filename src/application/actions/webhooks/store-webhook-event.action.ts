import type { Clock } from '../../../domain/contracts/clock.contract';
import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { WebhookEventStatus } from '../../../domain/entities/webhook-event.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { redactHeaders } from '../../../support/redact-headers';

export interface VerifiedProviderWebhook {
  providerEventId: string;
  type: string;
  normalizedType: string | null;
  data: Record<string, unknown>;
}

export interface WebhookEventStorageDependencies {
  storage: StorageDriver;
  providerName: string;
  clock: Clock;
}

export interface StoreWebhookEventInput {
  verified: VerifiedProviderWebhook;
  payload: string;
  signature?: string | null;
  headers?: Record<string, string>;
  tenantId?: string | null;
}

export interface StoredWebhookEvent {
  id: string;
  correlationId: string;
  duplicate: boolean;
  status: WebhookEventStatus;
}

export class StoreWebhookEventAction {
  constructor(private readonly deps: WebhookEventStorageDependencies) {}

  async handle(input: StoreWebhookEventInput): Promise<StoredWebhookEvent> {
    const { storage, providerName, clock } = this.deps;
    const tenantId = input.tenantId ?? null;
    const existing = await storage.webhookEvents.findByProviderEvent(
      providerName,
      input.verified.providerEventId,
      tenantId,
    );
    if (existing) {
      return {
        id: existing.id,
        correlationId: existing.correlationId,
        duplicate: true,
        status: existing.status,
      };
    }
    const correlationId = CorrelationId.generate().toString();
    try {
      const created = await storage.webhookEvents.create({
        tenantId,
        provider: providerName,
        providerEventId: input.verified.providerEventId,
        type: input.verified.type,
        normalizedType: input.verified.normalizedType,
        payload: input.payload,
        signature: input.signature ?? null,
        data: input.verified.data,
        headers: redactHeaders(input.headers ?? {}),
        status: 'pending',
        correlationId,
        receivedAt: clock.now(),
      });
      return { id: created.id, correlationId, duplicate: false, status: 'pending' };
    } catch (error) {
      const raced = await storage.webhookEvents.findByProviderEvent(
        providerName,
        input.verified.providerEventId,
        tenantId,
      );
      if (raced) {
        return {
          id: raced.id,
          correlationId: raced.correlationId,
          duplicate: true,
          status: raced.status,
        };
      }
      throw error;
    }
  }
}
