export interface CreateProviderWebhookEndpointInput {
  url: string;
  events: string[];
}

export interface UpdateProviderWebhookEndpointInput {
  providerWebhookEndpointId: string;
  url?: string;
  events?: string[];
}

export interface ListProviderWebhookEndpointsInput {
  limit?: number;
}

export interface ProviderWebhookEndpointDTO {
  providerWebhookEndpointId: string;
  url: string;
  events: string[];
  signingSecret: string | null;
  status: 'enabled' | 'disabled' | null;
}
