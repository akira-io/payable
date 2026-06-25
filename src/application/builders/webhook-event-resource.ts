import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { WebhookEvent, WebhookEventStatus } from '../../domain/entities/webhook-event.entity';

export interface ListWebhookEventsInput {
  provider?: string;
  status?: WebhookEventStatus;
  type?: string;
  limit?: number;
}

export class WebhookEventResource {
  constructor(
    private readonly storage: StorageDriver,
    private readonly tenantId: string | null,
  ) {}

  list(input: ListWebhookEventsInput = {}): Promise<WebhookEvent[]> {
    return this.storage.webhookEvents.list({ ...input, tenantId: this.tenantId });
  }

  get(id: string): Promise<WebhookEvent | null> {
    return this.storage.webhookEvents.findById(id, this.tenantId);
  }
}
