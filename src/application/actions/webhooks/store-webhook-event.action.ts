import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';

export interface StoreWebhookEventInput {
  verified: VerifiedWebhook;
  payload: string;
  headers?: Record<string, string>;
}

export interface StoredWebhookEvent {
  id: string;
  correlationId: string;
  duplicate: boolean;
}

export class StoreWebhookEventAction {
  constructor(private readonly deps: WebhookDependencies) {}

  async handle(input: StoreWebhookEventInput): Promise<StoredWebhookEvent> {
    const { storage, providerName, clock } = this.deps;
    const existing = await storage.webhookEvents.findByProviderEvent(
      providerName,
      input.verified.providerEventId,
    );
    if (existing) {
      return { id: existing.id, correlationId: existing.correlationId, duplicate: true };
    }
    const correlationId = CorrelationId.generate().toString();
    try {
      const created = await storage.webhookEvents.create({
        tenantId: null,
        provider: providerName,
        providerEventId: input.verified.providerEventId,
        type: input.verified.type,
        normalizedType: input.verified.normalizedType,
        payload: input.payload,
        data: input.verified.data,
        headers: input.headers ?? {},
        status: 'pending',
        correlationId,
        receivedAt: clock.now(),
      });
      return { id: created.id, correlationId, duplicate: false };
    } catch (error) {
      const raced = await storage.webhookEvents.findByProviderEvent(
        providerName,
        input.verified.providerEventId,
      );
      if (raced) {
        return { id: raced.id, correlationId: raced.correlationId, duplicate: true };
      }
      throw error;
    }
  }
}
