import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import type { WebhookEventStatus } from '../../../domain/entities/webhook-event.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { redactHeaders } from '../../../support/redact-headers';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';

export interface StoreWebhookEventInput {
  verified: VerifiedWebhook;
  payload: string;
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
  constructor(private readonly deps: WebhookDependencies) {}

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
