import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { isProviderWebhookEndpointManagementCapable } from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

function fakeStripe(endpoints: Stripe.WebhookEndpoint[]) {
  const calls: Record<string, unknown[] | number | undefined> = {};
  const client = {
    webhookEndpoints: {
      create: (...args: unknown[]) => {
        calls.create = args;
        return Promise.resolve(endpoints[0]);
      },
      list: (...args: unknown[]) => {
        calls.list = args;
        return {
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            calls.pagingLimit = limit;
            return endpoints.slice(0, limit);
          },
        };
      },
      retrieve: (...args: unknown[]) => {
        calls.retrieve = args;
        return Promise.resolve(endpoints[0]);
      },
      update: (...args: unknown[]) => {
        calls.update = args;
        return Promise.resolve(endpoints[0]);
      },
      del: (...args: unknown[]) => {
        calls.del = args;
        return Promise.resolve({ id: 'we_1', deleted: true });
      },
    },
  } as unknown as Stripe;
  return { client, calls };
}

const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

const endpoint = {
  id: 'we_1',
  url: 'https://shop.test/webhooks/stripe',
  enabled_events: ['payment_intent.succeeded'],
  secret: 'whsec_created',
  status: 'enabled',
} as Stripe.WebhookEndpoint;

describe('Stripe provider webhook endpoint management', () => {
  it('declares the optional capability', () => {
    const { client } = fakeStripe([]);
    const instance = provider(client);
    expect(instance.capabilities().has('webhookEndpointManagement')).toBe(true);
    expect(isProviderWebhookEndpointManagementCapable(instance)).toBe(true);
  });

  it('creates and maps a webhook endpoint with idempotency', async () => {
    const { client, calls } = fakeStripe([endpoint]);
    const result = await provider(client).createWebhookEndpoint(
      { url: endpoint.url, events: ['payment_intent.succeeded'] },
      ctx,
    );

    expect(calls.create).toEqual([
      { url: endpoint.url, enabled_events: ['payment_intent.succeeded'] },
      { idempotencyKey: 'idem-1' },
    ]);
    expect(result).toEqual({
      providerWebhookEndpointId: 'we_1',
      url: endpoint.url,
      events: ['payment_intent.succeeded'],
      signingSecret: 'whsec_created',
      status: 'enabled',
    });
  });

  it('lists webhook endpoints with bounded auto-pagination', async () => {
    const { client, calls } = fakeStripe([endpoint]);
    const result = await provider(client).listWebhookEndpoints({ limit: 125 });

    expect(calls.list).toEqual([{ limit: 100 }]);
    expect(calls.pagingLimit).toBe(125);
    expect(result).toHaveLength(1);
  });

  it('retrieves an endpoint without assuming its creation-only secret', async () => {
    const { client, calls } = fakeStripe([{ ...endpoint, secret: undefined }]);
    const result = await provider(client).retrieveWebhookEndpoint('we_1');
    expect(calls.retrieve).toEqual(['we_1']);
    expect(result.signingSecret).toBeNull();
  });

  it('updates URL and events with idempotency', async () => {
    const { client, calls } = fakeStripe([endpoint]);
    await provider(client).updateWebhookEndpoint(
      {
        providerWebhookEndpointId: 'we_1',
        url: 'https://shop.test/webhooks/new',
        events: ['payout.paid'],
      },
      ctx,
    );
    expect(calls.update).toEqual([
      'we_1',
      { url: 'https://shop.test/webhooks/new', enabled_events: ['payout.paid'] },
      { idempotencyKey: 'idem-1' },
    ]);
  });

  it('deletes an endpoint with idempotency', async () => {
    const { client, calls } = fakeStripe([endpoint]);
    await provider(client).deleteWebhookEndpoint('we_1', ctx);
    expect(calls.del).toEqual(['we_1', {}, { idempotencyKey: 'idem-1' }]);
  });
});
