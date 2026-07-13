import { describe, expect, it } from 'vitest';
import { isProviderWebhookEndpointManagementCapable } from '../src/domain/contracts/payment-provider.contract';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(...responses: unknown[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const body = responses.shift();
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: body === undefined ? 204 : 200,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

const provider = (fetch: RevolutProviderOptions['fetch']) =>
  new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test', fetch });

const endpoint = {
  id: 'webhook-1',
  url: 'https://shop.test/webhooks/revolut',
  events: ['ORDER_COMPLETED'],
  signing_secret: 'wsk_created',
};

describe('Revolut provider webhook endpoint management', () => {
  it('declares the optional capability', () => {
    const { fetch } = fakeFetch({ webhooks: [] });
    const instance = provider(fetch);
    expect(instance.capabilities().has('webhookEndpointManagement')).toBe(true);
    expect(isProviderWebhookEndpointManagementCapable(instance)).toBe(true);
  });

  it('creates and maps a webhook without unsupported idempotency', async () => {
    const { fetch, calls } = fakeFetch(endpoint);
    const result = await provider(fetch).createWebhookEndpoint(
      { url: endpoint.url, events: ['ORDER_COMPLETED'] },
      ctx,
    );

    expect(calls[0]).toMatchObject({
      url: 'https://merchant.revolut.com/api/webhooks',
      method: 'POST',
      body: { url: endpoint.url, events: ['ORDER_COMPLETED'] },
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
    expect(result).toEqual({
      providerWebhookEndpointId: 'webhook-1',
      url: endpoint.url,
      events: ['ORDER_COMPLETED'],
      signingSecret: 'wsk_created',
      status: null,
    });
  });

  it('lists webhooks and applies the requested limit locally', async () => {
    const { fetch, calls } = fakeFetch({ webhooks: [endpoint, { ...endpoint, id: 'webhook-2' }] });
    const result = await provider(fetch).listWebhookEndpoints({ limit: 1 });
    expect(calls[0]?.url).toBe('https://merchant.revolut.com/api/webhooks');
    expect(result).toHaveLength(1);
  });

  it('retrieves a webhook endpoint', async () => {
    const { fetch, calls } = fakeFetch(endpoint);
    const result = await provider(fetch).retrieveWebhookEndpoint('webhook/1');
    expect(calls[0]?.url).toBe('https://merchant.revolut.com/api/webhooks/webhook%2F1');
    expect(result.signingSecret).toBe('wsk_created');
  });

  it('updates URL and events without unsupported idempotency', async () => {
    const { fetch, calls } = fakeFetch(endpoint);
    await provider(fetch).updateWebhookEndpoint(
      {
        providerWebhookEndpointId: 'webhook-1',
        url: 'https://shop.test/webhooks/new',
        events: ['PAYOUT_COMPLETED'],
      },
      ctx,
    );
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      body: {
        url: 'https://shop.test/webhooks/new',
        events: ['PAYOUT_COMPLETED'],
      },
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('deletes a webhook without unsupported idempotency', async () => {
    const { fetch, calls } = fakeFetch();
    await provider(fetch).deleteWebhookEndpoint('webhook-1', ctx);
    expect(calls[0]).toMatchObject({
      url: 'https://merchant.revolut.com/api/webhooks/webhook-1',
      method: 'DELETE',
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });
});
