import type { TenantScoped } from './common';

export type WebhookEventStatus = 'pending' | 'processed' | 'failed';

export interface WebhookEvent extends TenantScoped {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly type: string;
  readonly payload: string;
  readonly headers: Record<string, string>;
  readonly status: WebhookEventStatus;
  readonly correlationId: string;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}
