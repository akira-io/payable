import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { ProviderSubscriptionChangeInput } from '../src/domain/dtos/subscription-change.dto';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const context = { correlationId: 'correlation', idempotencyKey: 'idempotency' };
const calculatedAt = new Date('2026-08-07T10:00:00.000Z');

function changeInput(
  overrides: Partial<ProviderSubscriptionChangeInput> = {},
): ProviderSubscriptionChangeInput {
  const input: ProviderSubscriptionChangeInput = {
    providerSubscriptionId: 'subscription_provider',
    currentItems: [
      { itemId: 'item_local', providerItemId: 'item_provider', priceId: 'price_old', quantity: 1 },
    ],
    proposedItems: [
      { itemId: 'item_local', providerItemId: 'item_provider', priceId: 'price_new', quantity: 2 },
    ],
    effectiveTiming: 'immediate',
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    calculatedAt,
    renewalDate: new Date('2026-09-07T10:00:00.000Z'),
  };
  return { ...input, ...overrides } as ProviderSubscriptionChangeInput;
}

describe('Stripe subscription change', () => {
  it('rejects direct updates that omit explicit policies', async () => {
    const stripe = {
      subscriptions: {
        update: () => Promise.resolve({ id: 'subscription_provider', status: 'active' }),
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);

    await expect(
      provider.updateSubscription(
        {
          providerSubscriptionId: 'subscription_provider',
          providerItemId: 'item_provider',
          priceId: 'price_new',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED' });
  });

  it('reuses the preview item set, proration date, and explicit policies on apply', async () => {
    let previewParameters: unknown;
    let updateParameters: unknown;
    const stripe = {
      invoices: {
        createPreview: (parameters: unknown) => {
          previewParameters = parameters;
          return Promise.resolve({
            currency: 'usd',
            amount_due: 2_000,
            period_end: 1_788_774_400,
            lines: {
              data: [
                {
                  amount: 500,
                  parent: { subscription_item_details: { proration: true } },
                },
              ],
            },
          });
        },
      },
      subscriptions: {
        update: (_id: string, parameters: unknown) => {
          updateParameters = parameters;
          return Promise.resolve({
            id: 'subscription_provider',
            status: 'active',
            items: { data: [] },
          });
        },
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);
    const input = changeInput();

    const preview = await provider.previewSubscriptionChange(input, context);
    await provider.applySubscriptionChange(input, context);

    const items = [{ id: 'item_provider', price: 'price_new', quantity: 2 }];
    expect(previewParameters).toEqual({
      subscription: 'subscription_provider',
      subscription_details: {
        items,
        proration_behavior: 'always_invoice',
        proration_date: 1_786_096_800,
      },
    });
    expect(updateParameters).toEqual({
      items,
      proration_behavior: 'always_invoice',
      proration_date: 1_786_096_800,
      payment_behavior: 'error_if_incomplete',
    });
    expect(preview.immediateAdjustment).toEqual({
      direction: 'charge',
      amount: 500,
      currency: 'USD',
    });
  });
});

describe('Paddle subscription change', () => {
  it('reuses the complete item set and explicit billing policies on apply', async () => {
    let previewBody: unknown;
    let updateBody: unknown;
    const client = {
      subscriptions: {
        previewUpdate: (_id: string, body: unknown) => {
          previewBody = body;
          return Promise.resolve({
            updateSummary: {
              result: { action: 'credit', amount: '300', currencyCode: 'EUR' },
            },
            nextTransaction: {
              details: { totals: { total: '1900', currencyCode: 'EUR' } },
              billingPeriod: { startsAt: '2026-09-07T10:00:00.000Z' },
            },
          });
        },
        update: (_id: string, body: unknown) => {
          updateBody = body;
          return Promise.resolve({ id: 'subscription_provider', status: 'active' });
        },
      },
    } as unknown as PaddleClient;
    const provider = new PaddleProvider({ apiKey: 'pdl', webhookSecret: 'wh' }, client);
    const input = changeInput();

    const preview = await provider.previewSubscriptionChange(input, context);
    await provider.applySubscriptionChange(input, context);

    const expectedBody = {
      items: [{ priceId: 'price_new', quantity: 2 }],
      prorationBillingMode: 'prorated_immediately',
      onPaymentFailure: 'prevent_change',
    };
    expect(previewBody).toEqual(expectedBody);
    expect(updateBody).toEqual(expectedBody);
    expect(preview.immediateAdjustment).toEqual({
      direction: 'credit',
      amount: 300,
      currency: 'EUR',
    });
  });
});

describe('Revolut subscription change', () => {
  it('previews and applies only the documented cycle-end policy', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            id: 'subscription_provider',
            state: 'active',
            created_at: '2026-08-07T10:00:00.000Z',
            updated_at: '2026-08-07T10:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 204 });
    };
    const provider = new RevolutProvider({ secretKey: 'sk', webhookSecret: 'wh', fetch });
    const input = changeInput({
      effectiveTiming: 'nextRenewal',
      prorationPolicy: 'none',
      paymentFailurePolicy: 'applyChange',
    });

    const preview = await provider.previewSubscriptionChange(input, context);
    await provider.applySubscriptionChange(input, context);

    expect(preview).toMatchObject({
      immediateAdjustment: { direction: 'none', amount: 0, currency: null },
      nextRenewal: { amount: null, date: input.renewalDate, currency: null },
      providerLimitations: [expect.stringContaining('does not expose')],
    });
    expect(calls[0]).toMatchObject({
      url: expect.stringContaining('/subscriptions/subscription_provider/change-plan'),
      body: { plan_variation_id: 'price_new', scheduled: 'at_cycle_end' },
    });
  });

  it('rejects unsupported policies with the stable capability error', async () => {
    const provider = new RevolutProvider({ secretKey: 'sk', webhookSecret: 'wh' });
    await expect(provider.previewSubscriptionChange(changeInput(), context)).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
  });
});
