export interface WebhookVerificationInput {
  payload: string;
  signature: string;
  headers?: Record<string, string>;
}

export interface VerifiedWebhook {
  providerEventId: string;
  type: string;
  data: Record<string, unknown>;
}
