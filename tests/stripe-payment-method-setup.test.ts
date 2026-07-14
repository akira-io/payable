import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { isPaymentMethodSetupCapable } from '../src/domain/contracts/payment-provider.contract';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'setup-1' };

function setupIntent(
  status: Stripe.SetupIntent.Status = 'requires_action',
  overrides: Partial<Stripe.SetupIntent> = {},
): Stripe.SetupIntent {
  return {
    id: 'seti_1',
    status,
    customer: 'cus_1',
    usage: 'off_session',
    client_secret: 'seti_secret',
    payment_method: null,
    created: 1_725_000_000,
    ...overrides,
  } as Stripe.SetupIntent;
}

function fakeStripe(intent = setupIntent()) {
  const create = vi.fn().mockResolvedValue(intent);
  const retrieve = vi.fn().mockResolvedValue(intent);
  const cancel = vi.fn().mockResolvedValue({ ...intent, status: 'canceled' });
  const client = { setupIntents: { create, retrieve, cancel } } as unknown as Stripe;
  return { client, create, retrieve, cancel };
}

const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

describe('Stripe payment method setup', () => {
  it('advertises the complete optional capability', () => {
    const { client } = fakeStripe();
    const instance = provider(client);

    expect(instance.capabilities().has('paymentMethodSetup')).toBe(true);
    expect(isPaymentMethodSetupCapable(instance)).toBe(true);
  });

  it('creates a Setup Intent and forwards normalized inputs and idempotency', async () => {
    const { client, create } = fakeStripe();

    const result = await provider(client).createPaymentMethodSetup(
      {
        providerCustomerId: 'cus_1',
        usage: 'off_session',
        currency: 'USD',
        paymentMethodTypes: ['card'],
        returnUrl: 'https://app.test/return',
        reference: 'customer-setup-1',
      },
      ctx,
    );

    expect(create).toHaveBeenCalledWith(
      {
        customer: 'cus_1',
        usage: 'off_session',
        payment_method_types: ['card'],
        return_url: 'https://app.test/return',
        metadata: { reference: 'customer-setup-1' },
      },
      { idempotencyKey: 'setup-1' },
    );
    expect(result).toEqual({
      providerSetupId: 'seti_1',
      providerCustomerId: 'cus_1',
      status: 'requires_action',
      usage: 'off_session',
      clientSecret: 'seti_secret',
      checkoutUrl: null,
      providerPaymentMethodId: null,
      createdAt: new Date(1_725_000_000_000),
    });
  });

  it('retrieves and maps expanded resource identifiers', async () => {
    const intent = setupIntent('succeeded', {
      customer: { id: 'cus_expanded' } as Stripe.Customer,
      payment_method: { id: 'pm_1' } as Stripe.PaymentMethod,
      usage: 'on_session',
    });
    const { client, retrieve } = fakeStripe(intent);

    const result = await provider(client).retrievePaymentMethodSetup('seti_1');

    expect(retrieve).toHaveBeenCalledWith('seti_1');
    expect(result).toMatchObject({
      providerCustomerId: 'cus_expanded',
      providerPaymentMethodId: 'pm_1',
      status: 'succeeded',
      usage: 'on_session',
    });
  });

  it('cancels a Setup Intent with the operation idempotency key', async () => {
    const { client, cancel } = fakeStripe();

    const result = await provider(client).cancelPaymentMethodSetup('seti_1', ctx);

    expect(cancel).toHaveBeenCalledWith('seti_1', {}, { idempotencyKey: 'setup-1' });
    expect(result.status).toBe('canceled');
  });

  it.each([
    ['requires_action', 'requires_action'],
    ['requires_confirmation', 'requires_action'],
    ['requires_payment_method', 'requires_action'],
    ['processing', 'processing'],
    ['succeeded', 'succeeded'],
    ['canceled', 'canceled'],
  ] as const)('maps %s to %s', async (stripeStatus, expected) => {
    const { client } = fakeStripe(setupIntent(stripeStatus));

    const result = await provider(client).retrievePaymentMethodSetup('seti_1');

    expect(result.status).toBe(expected);
  });

  it('normalizes Stripe Setup Intent errors', async () => {
    const client = {
      setupIntents: {
        retrieve: vi
          .fn()
          .mockRejectedValue({ type: 'StripeInvalidRequestError', message: 'bad setup intent' }),
      },
    } as unknown as Stripe;

    await expect(provider(client).retrievePaymentMethodSetup('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
