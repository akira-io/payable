import type { TenantScoped } from './common';

export type WebhookDeliveryStatus = 'delivered' | 'failed';

export interface WebhookDelivery extends TenantScoped {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly responseCode: number | null;
  readonly responseBody: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
