import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { isPaymentMethodCapable } from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

function fakeStripe(methods: Stripe.PaymentMethod[]) {
  const calls: {
    list?: unknown[];
    pagingLimit?: number;
    retrieve?: unknown[];
    detach?: unknown[];
  } = {};
  const client = {
    customers: {
      listPaymentMethods: (...args: unknown[]) => {
        calls.list = args;
        return {
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            calls.pagingLimit = limit;
            return methods.slice(0, limit);
          },
        };
      },
      retrievePaymentMethod: (...args: unknown[]) => {
        calls.retrieve = args;
        return Promise.resolve(methods[0]);
      },
    },
    paymentMethods: {
      detach: (...args: unknown[]) => {
        calls.detach = args;
        return Promise.resolve(methods[0]);
      },
    },
  } as unknown as Stripe;
  return { client, calls };
}

const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

describe('Stripe payment methods', () => {
  it('declares the optional capability', () => {
    const { client } = fakeStripe([]);
    const instance = provider(client);
    expect(instance.capabilities().has('paymentMethods')).toBe(true);
    expect(isPaymentMethodCapable(instance)).toBe(true);
  });

  it('lists and maps customer payment methods within the requested limit', async () => {
    const methods = [
      {
        id: 'pm_card',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 7, exp_year: 2030 },
      },
      { id: 'pm_link', type: 'link' },
    ] as Stripe.PaymentMethod[];
    const { client, calls } = fakeStripe(methods);

    const result = await provider(client).listPaymentMethods({
      providerCustomerId: 'cus_1',
      limit: 2,
    });

    expect(calls.list).toEqual(['cus_1', { limit: 2 }]);
    expect(calls.pagingLimit).toBe(2);
    expect(result).toEqual([
      {
        providerPaymentMethodId: 'pm_card',
        providerCustomerId: 'cus_1',
        type: 'card',
        brand: 'visa',
        last4: '4242',
        expiresMonth: 7,
        expiresYear: 2030,
      },
      {
        providerPaymentMethodId: 'pm_link',
        providerCustomerId: 'cus_1',
        type: 'link',
        brand: null,
        last4: null,
        expiresMonth: null,
        expiresYear: null,
      },
    ]);
  });

  it('detaches a payment method with the operation idempotency key', async () => {
    const { client, calls } = fakeStripe([]);
    await provider(client).deletePaymentMethod(
      { providerCustomerId: 'cus_1', providerPaymentMethodId: 'pm_1' },
      ctx,
    );
    expect(calls.retrieve).toEqual(['cus_1', 'pm_1']);
    expect(calls.detach).toEqual(['pm_1', {}, { idempotencyKey: 'idem-1' }]);
  });

  it('normalizes Stripe list errors', async () => {
    const client = {
      customers: {
        listPaymentMethods: () => {
          throw { type: 'StripeInvalidRequestError', message: 'bad customer' };
        },
      },
    } as unknown as Stripe;

    await expect(
      provider(client).listPaymentMethods({ providerCustomerId: 'missing' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
  });
});
