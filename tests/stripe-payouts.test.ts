import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { isPayoutCapable } from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

function fakeStripe(payouts: Stripe.Payout[]) {
  const calls: { list?: unknown[]; pagingLimit?: number; retrieve?: unknown[] } = {};
  const client = {
    payouts: {
      list: (...args: unknown[]) => {
        calls.list = args;
        return {
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            calls.pagingLimit = limit;
            return payouts.slice(0, limit);
          },
        };
      },
      retrieve: (...args: unknown[]) => {
        calls.retrieve = args;
        return Promise.resolve(payouts[0]);
      },
    },
  } as unknown as Stripe;
  return { client, calls };
}

const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

const payout = {
  id: 'po_1',
  amount: 4500,
  currency: 'usd',
  status: 'in_transit',
  created: 1_750_000_000,
  arrival_date: 1_750_086_400,
} as Stripe.Payout;

describe('Stripe payouts', () => {
  it('declares the optional capability', () => {
    const { client } = fakeStripe([]);
    const instance = provider(client);
    expect(instance.capabilities().has('payouts')).toBe(true);
    expect(isPayoutCapable(instance)).toBe(true);
  });

  it('lists and maps payouts within the requested limit', async () => {
    const { client, calls } = fakeStripe([payout]);
    const [result] = await provider(client).listPayouts({ limit: 1 });

    expect(calls.list).toEqual([{ limit: 1 }]);
    expect(calls.pagingLimit).toBe(1);
    expect(result).toMatchObject({
      providerPayoutId: 'po_1',
      status: 'in_transit',
      createdAt: new Date(1_750_000_000 * 1000),
      arrivalAt: new Date(1_750_086_400 * 1000),
    });
    expect(result?.amount?.amount()).toBe(4500);
    expect(result?.amount?.currency()).toBe('USD');
  });

  it('retrieves and normalizes a payout', async () => {
    const { client, calls } = fakeStripe([{ ...payout, status: 'paid' } as Stripe.Payout]);
    const result = await provider(client).retrievePayout('po_1');

    expect(calls.retrieve).toEqual(['po_1']);
    expect(result.status).toBe('paid');
  });

  it('normalizes Stripe payout errors', async () => {
    const client = {
      payouts: {
        retrieve: () => {
          throw { type: 'StripeInvalidRequestError', message: 'missing payout' };
        },
      },
    } as unknown as Stripe;
    await expect(provider(client).retrievePayout('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
