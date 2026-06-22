import type { NormalizedEventName } from '../events/domain-event';

export interface WebhookVerificationInput {
  payload: string;
  signature: string;
  headers?: Record<string, string>;
}

export interface VerifiedWebhook {
  providerEventId: string;
  type: string;
  normalizedType: NormalizedEventName | null;
  data: Record<string, unknown>;
}
