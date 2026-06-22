import type { TenantScoped } from './common';

export type WebhookEventStatus = 'pending' | 'processed' | 'failed';

export interface WebhookEvent extends TenantScoped {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly type: string;
  readonly normalizedType: string | null;
  readonly payload: string;
  readonly data: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly status: WebhookEventStatus;
  readonly correlationId: string;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}
