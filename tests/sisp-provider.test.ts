import { describe, expect, it } from 'vitest';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import { Money } from '../src/domain/value-objects/money';
import { sispMerchantReference } from '../src/infrastructure/providers/sisp/sisp-merchant-reference';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import type {
  SispCallbackOutcome,
  SispClient,
  SispHttpRequestInfo,
  SispNormalizedCallbackPayload,
} from '../src/infrastructure/providers/sisp/sisp-types';
import { inertCorrelationStore } from './support/sisp';

const ctx: OperationContext = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

const OPTIONS: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  correlation: inertCorrelationStore(),
};

const GATEWAY = 'https://mc.vinti4net.cv/Client_VbV_v2/biz_vbv_clientdata.jsp';

const passthrough = (payload: Record<string, unknown>) =>
  payload as unknown as SispNormalizedCallbackPayload;

interface CallbackState {
  verified: boolean;
  status: string;
  reason: string | null;
}

function fakeSisp(state: CallbackState = { verified: true, status: 'completed', reason: null }) {
  const calls: { payment?: SispHttpRequestInfo; callback?: SispNormalizedCallbackPayload } = {};
  const client: SispClient = {
    config: { generators: { merchantReference: () => 'R-DEFAULT' } },
    handlers: {
      handlePayment: async (request) => {
        calls.payment = request;
        return { type: 'html', status: 200, html: `<form>${request.body.merchantRef}</form>` };
      },
    },
    driver: () => ({ paymentEndpoint: () => GATEWAY }),
    validateCallback: (payload) => (payload as unknown as { ok?: boolean }).ok === true,
    handleCallback: async (payload): Promise<SispCallbackOutcome> => {
      calls.callback = payload;
      return { verified: state.verified, status: state.status, reason: state.reason, payload };
    },
  };
  return { client, calls, state };
}

function provider(client: SispClient): SispProvider {
  return new SispProvider(OPTIONS, client, passthrough);
}

describe('SispProvider', () => {
  it('advertises only the checkout capability', () => {
    const { client } = fakeSisp();
    const capabilities = provider(client).capabilities();
    expect(capabilities.has('checkout')).toBe(true);
    expect(capabilities.has('refunds')).toBe(false);
    expect(capabilities.has('subscriptions')).toBe(false);
    expect(capabilities.has('customers')).toBe(false);
    expect(capabilities.has('catalog')).toBe(false);
  });

  it('derives the merchant reference from the idempotency key so retries collapse', async () => {
    const { client, calls } = fakeSisp();
    const dto = await provider(client).createCheckoutSession(
      {
        providerCustomerId: 'local-1',
        mode: 'payment',
        lineItems: [],
        successUrl: 'https://shop.cv/ok',
        cancelUrl: 'https://shop.cv/cancel',
        amount: Money.of(150000, 'CVE'),
      },
      ctx,
    );
    const body = calls.payment?.body as Record<string, unknown>;
    expect(body.merchantRef).toBe(sispMerchantReference('idem-1'));
    expect(body.amount).toBe('1500.00');
    expect(body.items).toEqual([
      { product_name: 'Payment', quantity: 1, unit_price: '1500.00', total_price: '1500.00' },
    ]);
    expect(dto.id).toBe(body.merchantRef);
    expect(dto.url).toBe(GATEWAY);
    expect(dto.html).toContain(String(body.merchantRef));
  });

  it('rejects subscription checkout', async () => {
    const { client } = fakeSisp();
    await expect(
      provider(client).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'subscription',
          lineItems: [],
          successUrl: 'https://shop.cv/ok',
          cancelUrl: 'https://shop.cv/cancel',
          amount: Money.of(150000, 'CVE'),
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
  });

  it('rejects checkout without an amount', async () => {
    const { client } = fakeSisp();
    await expect(
      provider(client).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.cv/ok',
          cancelUrl: 'https://shop.cv/cancel',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CHECKOUT_AMOUNT_REQUIRED' });
  });

  it('rejects refunds', async () => {
    const { client } = fakeSisp();
    await expect(
      provider(client).refund({ providerPaymentId: 'R-abc' }, ctx),
    ).rejects.toMatchObject({ code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
  });

  it('maps an authentic approved callback to a succeeded payment', async () => {
    const { client } = fakeSisp({ verified: true, status: 'completed', reason: null });
    const result = await provider(client).handleRedirectCallback({ merchantRef: 'R-cb' });
    expect(result).toEqual({ providerPaymentId: 'R-cb', status: 'succeeded' });
  });

  it('maps an authentic declined callback to a failed payment rather than an error', async () => {
    const { client } = fakeSisp({ verified: true, status: 'failed', reason: null });
    const result = await provider(client).handleRedirectCallback({ merchantRef: 'R-cb' });
    expect(result).toEqual({ providerPaymentId: 'R-cb', status: 'failed' });
  });

  it('carries the rejection reason when the callback is not authentic', async () => {
    const { client } = fakeSisp({
      verified: false,
      status: 'pending',
      reason: 'invalid_callback_fingerprint',
    });
    await expect(
      provider(client).handleRedirectCallback({ merchantRef: 'R-cb' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SISP_INVALID_CALLBACK',
      context: { reason: 'invalid_callback_fingerprint' },
    });
  });

  it('verifies a callback fingerprint without consuming the correlation', async () => {
    const { client, calls } = fakeSisp();
    const subject = provider(client);
    expect(await subject.verifyCallback({ ok: true })).toBe(true);
    expect(await subject.verifyCallback({ ok: false })).toBe(false);
    expect(calls.callback).toBeUndefined();
  });

  it('treats a callback that throws during validation as invalid', async () => {
    const { client } = fakeSisp();
    client.validateCallback = () => {
      throw new Error('malformed payload');
    };
    expect(await provider(client).verifyCallback({ ok: true })).toBe(false);
  });

  it('rejects a gateway response that is not a payment form', async () => {
    const { client } = fakeSisp();
    client.handlers.handlePayment = async () => ({ type: 'json', status: 422, data: {} });
    await expect(
      provider(client).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.cv/ok',
          cancelUrl: 'https://shop.cv/cancel',
          amount: Money.of(150000, 'CVE'),
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_SISP_NO_FORM' });
  });

  it('never serializes the wrapped client', () => {
    const { client } = fakeSisp();
    const subject = provider(client);
    expect(subject.toJSON()).toEqual({ name: 'sisp' });
    expect(JSON.stringify(subject)).toBe('{"name":"sisp"}');
  });
});
