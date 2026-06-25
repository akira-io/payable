import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { WebhookEndpoint } from '../../domain/entities/webhook-endpoint.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { WebhookEndpointUrl } from '../../domain/value-objects/webhook-endpoint-url';
import { WebhookSigningSecret } from '../../domain/value-objects/webhook-signing-secret';

export interface RegisterWebhookEndpointInput {
  url: string;
  events: string[];
}

export class WebhookEndpointResource {
  constructor(
    private readonly storage: StorageDriver,
    private readonly tenantId: string | null,
  ) {}

  async register(input: RegisterWebhookEndpointInput): Promise<WebhookEndpoint> {
    const url = WebhookEndpointUrl.parse(input.url);
    const events = this.normalizeEvents(input.events);
    return this.storage.webhookEndpoints.create({
      tenantId: this.tenantId,
      url: url.toString(),
      events,
      secret: WebhookSigningSecret.generate().toString(),
      status: 'enabled',
    });
  }

  async list(): Promise<Omit<WebhookEndpoint, 'secret'>[]> {
    const endpoints = await this.storage.webhookEndpoints.list(this.tenantId);
    return endpoints.map(({ secret: _secret, ...rest }) => rest);
  }

  enable(id: string): Promise<WebhookEndpoint> {
    return this.storage.webhookEndpoints.setStatus(id, 'enabled', this.tenantId);
  }

  disable(id: string): Promise<WebhookEndpoint> {
    return this.storage.webhookEndpoints.setStatus(id, 'disabled', this.tenantId);
  }

  private normalizeEvents(events: string[]): string[] {
    const cleaned = Array.from(new Set(events.map((event) => event.trim()).filter(Boolean)));
    if (cleaned.length === 0) {
      throw new PayableError('A webhook endpoint must subscribe to at least one event type', {
        code: 'WEBHOOK_ENDPOINT_EVENTS_REQUIRED',
      });
    }
    return cleaned;
  }
}
