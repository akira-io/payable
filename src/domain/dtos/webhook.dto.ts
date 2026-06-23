import type { NormalizedEventName } from '../events/domain-event';

export interface WebhookVerificationInput {
  /** Raw, unparsed request body; signature verification only holds against the exact bytes the provider signed. */
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
