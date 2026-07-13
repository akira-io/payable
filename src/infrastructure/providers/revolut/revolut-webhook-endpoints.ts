import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateProviderWebhookEndpointInput,
  ListProviderWebhookEndpointsInput,
  ProviderWebhookEndpointDTO,
  UpdateProviderWebhookEndpointInput,
} from '../../../domain/dtos/provider-webhook-endpoint.dto';
import { toRevolutWebhookEndpointDTO } from './revolut-mappers';
import type { RevolutRequest, RevolutWebhook, RevolutWebhooks } from './revolut-types';

const MAX_WEBHOOK_ENDPOINTS = 10;

export class RevolutWebhookEndpoints {
  constructor(private readonly request: RevolutRequest) {}

  async create(
    input: CreateProviderWebhookEndpointInput,
    _ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    const endpoint = await this.request<RevolutWebhook>('/api/webhooks', {
      method: 'POST',
      body: { url: input.url, events: input.events },
    });
    return toRevolutWebhookEndpointDTO(endpoint);
  }

  async list(input: ListProviderWebhookEndpointsInput = {}): Promise<ProviderWebhookEndpointDTO[]> {
    const response = await this.request<RevolutWebhooks>('/api/webhooks', { method: 'GET' });
    const limit = Math.min(input.limit ?? MAX_WEBHOOK_ENDPOINTS, MAX_WEBHOOK_ENDPOINTS);
    return response.webhooks.slice(0, limit).map(toRevolutWebhookEndpointDTO);
  }

  async retrieve(providerWebhookEndpointId: string): Promise<ProviderWebhookEndpointDTO> {
    const endpoint = await this.request<RevolutWebhook>(
      `/api/webhooks/${encodeURIComponent(providerWebhookEndpointId)}`,
      { method: 'GET' },
    );
    return toRevolutWebhookEndpointDTO(endpoint);
  }

  async update(
    input: UpdateProviderWebhookEndpointInput,
    _ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    const endpoint = await this.request<RevolutWebhook>(
      `/api/webhooks/${encodeURIComponent(input.providerWebhookEndpointId)}`,
      { method: 'PATCH', body: { url: input.url, events: input.events } },
    );
    return toRevolutWebhookEndpointDTO(endpoint);
  }

  async delete(providerWebhookEndpointId: string, _ctx: OperationContext): Promise<void> {
    await this.request(`/api/webhooks/${encodeURIComponent(providerWebhookEndpointId)}`, {
      method: 'DELETE',
    });
  }
}
