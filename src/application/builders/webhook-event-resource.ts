import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { WebhookEvent, WebhookEventStatus } from '../../domain/entities/webhook-event.entity';

export interface ListWebhookEventsInput {
  provider?: string;
  status?: WebhookEventStatus;
  type?: string;
  limit?: number;
}

export type WebhookEventView = Omit<WebhookEvent, 'signature'>;

function toView({ signature: _signature, ...view }: WebhookEvent): WebhookEventView {
  return view;
}

export class WebhookEventResource {
  constructor(
    private readonly storage: StorageDriver,
    private readonly tenantId: string | null,
  ) {}

  async list(input: ListWebhookEventsInput = {}): Promise<WebhookEventView[]> {
    const events = await this.storage.webhookEvents.list({ ...input, tenantId: this.tenantId });
    return events.map(toView);
  }

  async get(id: string): Promise<WebhookEventView | null> {
    const event = await this.storage.webhookEvents.findById(id, this.tenantId);
    return event ? toView(event) : null;
  }
}
