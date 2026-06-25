import type { Clock } from '../../../domain/contracts/clock.contract';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type { OutboxEvent } from '../../../domain/contracts/outbox-event-repository.contract';
import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { WebhookEndpoint } from '../../../domain/entities/webhook-endpoint.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { signWebhookPayload } from '../../../support/hash/webhook-signature';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 2_000;
const VERSION_SUFFIX = /\.v\d+$/;

export interface WebhookDeliveryOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  logger?: Logger;
}

interface DeliveryOutcome {
  ok: boolean;
  responseCode: number | null;
  responseBody: string | null;
}

export class WebhookDeliveryService {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  constructor(
    private readonly storage: StorageDriver,
    private readonly clock: Clock,
    options: WebhookDeliveryOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
  }

  async handle(event: OutboxEvent): Promise<void> {
    const eventType = event.eventType.replace(VERSION_SUFFIX, '');
    const endpoints = await this.storage.webhookEndpoints.listEnabledForEvent(
      eventType,
      event.tenantId,
    );
    if (endpoints.length === 0) {
      return;
    }
    const prior = await this.storage.webhookDeliveries.listForEvent(event.id, event.tenantId);
    const delivered = new Set(
      prior.filter((entry) => entry.status === 'delivered').map((entry) => entry.endpointId),
    );
    const body = JSON.stringify({
      id: event.id,
      type: eventType,
      createdAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    const timestamp = Math.floor(this.clock.now().getTime() / 1000);
    let incomplete = false;
    for (const endpoint of endpoints) {
      if (delivered.has(endpoint.id)) {
        continue;
      }
      const previousAttempts =
        prior.find((entry) => entry.endpointId === endpoint.id)?.attempts ?? 0;
      const outcome = await this.post(endpoint, eventType, event.id, body, timestamp);
      await this.storage.webhookDeliveries.record({
        tenantId: event.tenantId,
        endpointId: endpoint.id,
        eventId: event.id,
        eventType,
        payload: event.payload,
        status: outcome.ok ? 'delivered' : 'failed',
        attempts: previousAttempts + 1,
        responseCode: outcome.responseCode,
        responseBody: outcome.responseBody,
      });
      if (!outcome.ok) {
        incomplete = true;
      }
    }
    if (incomplete) {
      throw new PayableError('One or more webhook endpoints failed delivery', {
        code: 'WEBHOOK_DELIVERY_INCOMPLETE',
        context: { eventId: event.id, eventType },
      });
    }
  }

  private async post(
    endpoint: WebhookEndpoint,
    eventType: string,
    eventId: string,
    body: string,
    timestamp: number,
  ): Promise<DeliveryOutcome> {
    const signature = await signWebhookPayload(endpoint.secret, `${timestamp}.${body}`);
    try {
      const response = await this.fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payable-event-id': eventId,
          'payable-event-type': eventType,
          'payable-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return {
        ok: response.ok,
        responseCode: response.status,
        responseBody: await this.read(response),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn('Webhook delivery request failed', {
        endpointId: endpoint.id,
        eventId,
        error: message,
      });
      return { ok: false, responseCode: null, responseBody: message };
    }
  }

  private async read(response: Response): Promise<string | null> {
    try {
      const text = await response.text();
      return text.length > MAX_RESPONSE_BODY ? text.slice(0, MAX_RESPONSE_BODY) : text;
    } catch {
      return null;
    }
  }
}
