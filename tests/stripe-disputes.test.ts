import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { isDisputeCapable } from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

function fakeStripe(disputes: Stripe.Dispute[]) {
  const calls: {
    list?: unknown[];
    pagingLimit?: number;
    retrieve?: unknown[];
    close?: unknown[];
  } = {};
  const client = {
    disputes: {
      list: (...args: unknown[]) => {
        calls.list = args;
        return {
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            calls.pagingLimit = limit;
            return disputes.slice(0, limit);
          },
        };
      },
      retrieve: (...args: unknown[]) => {
        calls.retrieve = args;
        return Promise.resolve(disputes[0]);
      },
      close: (...args: unknown[]) => {
        calls.close = args;
        return Promise.resolve(disputes[0]);
      },
    },
  } as unknown as Stripe;
  return { client, calls };
}

const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

const dispute = {
  id: 'dp_1',
  amount: 2500,
  currency: 'usd',
  payment_intent: 'pi_1',
  charge: 'ch_1',
  status: 'needs_response',
  reason: 'fraudulent',
  created: 1_750_000_000,
  evidence_details: { due_by: 1_750_086_400 },
} as Stripe.Dispute;

describe('Stripe disputes', () => {
  it('declares the optional capability', () => {
    const { client } = fakeStripe([]);
    const instance = provider(client);
    expect(instance.capabilities().has('disputes')).toBe(true);
    expect(isDisputeCapable(instance)).toBe(true);
  });

  it('lists and maps disputes within the requested limit', async () => {
    const { client, calls } = fakeStripe([dispute]);
    const [result] = await provider(client).listDisputes({ limit: 1 });

    expect(calls.list).toEqual([{ limit: 1 }]);
    expect(calls.pagingLimit).toBe(1);
    expect(result).toMatchObject({
      providerDisputeId: 'dp_1',
      providerPaymentId: 'pi_1',
      status: 'needs_response',
      reason: 'fraudulent',
    });
    expect(result?.amount.amount()).toBe(2500);
    expect(result?.amount.currency()).toBe('USD');
    expect(result?.createdAt).toEqual(new Date(1_750_000_000 * 1000));
    expect(result?.responseDueAt).toEqual(new Date(1_750_086_400 * 1000));
  });

  it('retrieves a dispute and falls back to the charge id', async () => {
    const { client, calls } = fakeStripe([{ ...dispute, payment_intent: null } as Stripe.Dispute]);
    const result = await provider(client).retrieveDispute('dp_1');
    expect(calls.retrieve).toEqual(['dp_1']);
    expect(result.providerPaymentId).toBe('ch_1');
  });

  it('accepts a dispute with the operation idempotency key', async () => {
    const { client, calls } = fakeStripe([dispute]);
    await provider(client).acceptDispute('dp_1', ctx);
    expect(calls.close).toEqual(['dp_1', {}, { idempotencyKey: 'idem-1' }]);
  });

  it('normalizes Stripe dispute errors', async () => {
    const client = {
      disputes: {
        retrieve: () => {
          throw { type: 'StripeInvalidRequestError', message: 'missing dispute' };
        },
      },
    } as unknown as Stripe;
    await expect(provider(client).retrieveDispute('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
