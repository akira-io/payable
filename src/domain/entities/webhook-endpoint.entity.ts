import type { TenantScoped } from './common';

export type WebhookEndpointStatus = 'enabled' | 'disabled';

export interface WebhookEndpoint extends TenantScoped {
  readonly id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly secret: string;
  readonly status: WebhookEndpointStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
