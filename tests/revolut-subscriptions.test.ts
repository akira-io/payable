import { describe, expect, it } from 'vitest';
import {
  isDirectSubscriptionCapable,
  isSubscriptionManagementCapable,
} from '../src/domain/contracts/payment-provider.contract';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
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

interface FakeResponse {
  status?: number;
  body?: unknown;
}

function fakeFetch(...responses: FakeResponse[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    const headers = new Headers(init?.headers);
    const response = responses.shift() ?? {};
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function provider(fetch: RevolutProviderOptions['fetch']) {
  return new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment: 'sandbox',
    fetch,
  });
}

function subscription(state = 'active') {
  return {
    id: 'sub_1',
    state,
    customer_id: 'cus_1',
    plan_id: 'plan_1',
    plan_variation_id: 'plan_var_1',
    payment_method_type: 'automatic',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    current_cycle_id: 'cycle_1',
    trial_end_date: '2026-01-15T00:00:00Z',
  };
}

describe('RevolutProvider subscriptions', () => {
  it('advertises the generic subscription capability and guards', () => {
    const instance = new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test' });
    expect(instance.capabilities().has('subscriptions')).toBe(true);
    expect(isDirectSubscriptionCapable(instance)).toBe(true);
    expect(isSubscriptionManagementCapable(instance)).toBe(true);
  });

  it('creates a subscription checkout by resolving the setup order checkout URL', async () => {
    const { fetch, calls } = fakeFetch(
      {
        status: 201,
        body: { ...subscription('pending'), id: 'sub_1', setup_order_id: 'ord_setup_1' },
      },
      {
        status: 200,
        body: {
          id: 'ord_setup_1',
          state: 'pending',
          amount: 500,
          currency: 'GBP',
          checkout_url: 'https://checkout.revolut.com/payment-link/setup',
        },
      },
    );

    const dto = await provider(fetch).createCheckoutSession(
      {
        providerCustomerId: 'cus_1',
        mode: 'subscription',
        lineItems: [{ priceId: 'plan_var_1', quantity: 1 }],
        successUrl: 'https://shop.test/subscription/ok',
        cancelUrl: 'https://shop.test/subscription/cancel',
        trialDays: 14,
      },
      ctx,
    );

    expect(dto).toEqual({
      id: 'ord_setup_1',
      url: 'https://checkout.revolut.com/payment-link/setup',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/subscriptions',
      method: 'POST',
      body: {
        plan_variation_id: 'plan_var_1',
        customer_id: 'cus_1',
        setup_order_redirect_url: 'https://shop.test/subscription/ok',
        trial_duration: 'P14D',
      },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe('idem-1');
    expect(calls[1]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders/ord_setup_1',
      method: 'GET',
    });
  });

  it('creates a direct subscription using priceId as the Revolut plan variation id', async () => {
    const { fetch, calls } = fakeFetch({ status: 201, body: subscription('pending') });

    const dto = await provider(fetch).createSubscription(
      {
        providerCustomerId: 'cus_1',
        priceId: 'plan_var_1',
        trialDays: 14,
      },
      ctx,
    );

    expect(dto.providerSubscriptionId).toBe('sub_1');
    expect(dto.status).toBe('incomplete');
    expect(dto.currentPeriodEnd).toBeNull();
    expect(dto.trialEndsAt?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/subscriptions',
      method: 'POST',
      body: {
        plan_variation_id: 'plan_var_1',
        customer_id: 'cus_1',
        trial_duration: 'P14D',
      },
    });
  });

  it('schedules a plan change at cycle end and retrieves the updated subscription', async () => {
    const { fetch, calls } = fakeFetch({ status: 204 }, { status: 200, body: subscription() });

    const dto = await provider(fetch).updateSubscription(
      { providerSubscriptionId: 'sub_1', priceId: 'plan_var_2' },
      ctx,
    );

    expect(dto.status).toBe('active');
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/subscriptions/sub_1/change-plan',
      method: 'POST',
      body: { plan_variation_id: 'plan_var_2', scheduled: 'at_cycle_end' },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/subscriptions/sub_1',
      method: 'GET',
    });
  });

  it('cancels a subscription only when immediate cancellation is requested', async () => {
    const { fetch, calls } = fakeFetch({ status: 204 });
    const dto = await provider(fetch).cancelSubscription(
      { providerSubscriptionId: 'sub_1', immediately: true },
      ctx,
    );
    expect(dto).toEqual({
      providerSubscriptionId: 'sub_1',
      status: 'canceled',
      currentPeriodEnd: null,
      trialEndsAt: null,
    });
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/subscriptions/sub_1/cancel',
      method: 'POST',
    });

    await expect(
      provider(fetch).cancelSubscription({ providerSubscriptionId: 'sub_1' }, ctx),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });

  it('rejects unsupported subscription quantity and resume operations', async () => {
    const { fetch } = fakeFetch();
    await expect(
      provider(fetch).updateSubscription({ providerSubscriptionId: 'sub_1', quantity: 2 }, ctx),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    await expect(
      provider(fetch).resumeSubscription({ providerSubscriptionId: 'sub_1' }, ctx),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });

  it('reconciles subscription webhooks by subscription id', () => {
    const instance = new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test' });
    expect(
      instance.reconcileSubscription({
        providerEventId: 'evt_1',
        type: 'SUBSCRIPTION_INITIATED',
        normalizedType: 'subscription.created',
        data: { event: 'SUBSCRIPTION_INITIATED', subscription_id: 'sub_1' },
      }),
    ).toEqual({
      providerSubscriptionId: 'sub_1',
      status: 'incomplete',
      currentPeriodEnd: null,
      trialEndsAt: null,
    });
    expect(
      instance.reconcileSubscription({
        providerEventId: 'evt_2',
        type: 'ORDER_COMPLETED',
        normalizedType: 'payment.succeeded',
        data: { event: 'ORDER_COMPLETED', order_id: 'ord_1' },
      }),
    ).toBeNull();
  });
});
