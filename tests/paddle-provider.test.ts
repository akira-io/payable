import { describe, expect, it } from 'vitest';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
import { Money } from '../src/domain/value-objects/money';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type {
  PaddleClient,
  PaddleWebhookEvent,
} from '../src/infrastructure/providers/paddle/paddle-types';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

function fakePaddle(unmarshal?: () => Promise<PaddleWebhookEvent | null>) {
  const calls = new Map<string, unknown>();
  const record =
    <T>(name: string, result: T) =>
    (body: unknown) => {
      calls.set(name, body);
      return Promise.resolve(result);
    };
  const client = {
    customers: {
      create: record('customers.create', { id: 'ctm_1', email: 'user@example.com', name: 'User' }),
      update: record('customers.update', { id: 'ctm_1', email: 'new@example.com', name: 'User' }),
    },
    products: {
      create: record('products.create', { id: 'pro_1', name: 'Pro', status: 'active' }),
      update: record('products.update', { id: 'pro_1', name: 'Pro', status: 'archived' }),
    },
    prices: {
      create: (body: {
        productId: string;
        unitPrice: { amount: string; currencyCode: string };
      }) => {
        calls.set('prices.create', body);
        return Promise.resolve({
          id: 'pri_1',
          productId: body.productId,
          unitPrice: body.unitPrice,
        });
      },
    },
    transactions: {
      create: record('transactions.create', {
        id: 'txn_1',
        checkout: { url: 'https://pay.paddle.test/txn_1' },
      }),
    },
    subscriptions: {
      update: record('subscriptions.update', { id: 'sub_1', status: 'active' }),
      cancel: record('subscriptions.cancel', { id: 'sub_1', status: 'canceled' }),
      resume: record('subscriptions.resume', { id: 'sub_1', status: 'active' }),
    },
    adjustments: {
      create: record('adjustments.create', {
        id: 'adj_1',
        status: 'approved',
        totals: { total: '9900', currencyCode: 'USD' },
      }),
    },
    customerPortalSessions: {
      create: (customerId: string) => {
        calls.set('portal', customerId);
        return Promise.resolve({
          urls: { general: { overview: 'https://portal.paddle.test/ctm_1' } },
        });
      },
    },
    webhooks: {
      unmarshal:
        unmarshal ??
        (() =>
          Promise.resolve({
            eventId: 'evt_1',
            eventType: 'subscription.canceled',
            data: { id: 'sub_1' },
          })),
    },
  };
  return { client: client as unknown as PaddleClient, calls };
}

const provider = (client: PaddleClient): PaymentProvider =>
  new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, client);

describe('PaddleProvider', () => {
  it('reports Paddle capabilities', () => {
    const { client } = fakePaddle();
    const capabilities = provider(client).capabilities();
    expect(capabilities.checkout).toBe(true);
    expect(capabilities.invoicePdf).toBe(false);
  });

  it('creates a customer', async () => {
    const { client, calls } = fakePaddle();
    const dto = await provider(client).createCustomer(
      { email: 'user@example.com', name: 'User', billableType: 'User', billableId: '1' },
      ctx,
    );
    expect(dto).toEqual({ providerCustomerId: 'ctm_1', email: 'user@example.com', name: 'User' });
    expect(calls.get('customers.create')).toMatchObject({ email: 'user@example.com' });
  });

  it('converts Money to a Paddle string amount at the price boundary', async () => {
    const { client, calls } = fakePaddle();
    const dto = await provider(client).createPrice(
      { providerProductId: 'pro_1', unitAmount: Money.of(9900, 'USD'), interval: 'month' },
      ctx,
    );
    expect(calls.get('prices.create')).toMatchObject({
      productId: 'pro_1',
      unitPrice: { amount: '9900', currencyCode: 'USD' },
      billingCycle: { interval: 'month', frequency: 1 },
    });
    expect(dto.unitAmount.amount()).toBe(9900);
    expect(dto.unitAmount.currency()).toBe('USD');
  });

  it('opens a checkout via a transaction', async () => {
    const { client } = fakePaddle();
    const dto = await provider(client).createCheckoutSession(
      {
        providerCustomerId: 'ctm_1',
        mode: 'subscription',
        lineItems: [{ priceId: 'pri_1', quantity: 1 }],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      },
      ctx,
    );
    expect(dto).toEqual({ id: 'txn_1', url: 'https://pay.paddle.test/txn_1' });
  });

  it('refunds through an adjustment', async () => {
    const { client, calls } = fakePaddle();
    const dto = await provider(client).refund({ providerPaymentId: 'txn_1' }, ctx);
    expect(calls.get('adjustments.create')).toMatchObject({
      action: 'refund',
      transactionId: 'txn_1',
    });
    expect(dto.providerRefundId).toBe('adj_1');
    expect(dto.status).toBe('succeeded');
    expect(dto.amount.amount()).toBe(9900);
  });

  it('opens a billing portal session', async () => {
    const { client, calls } = fakePaddle();
    const dto = await provider(client).billingPortal(
      { providerCustomerId: 'ctm_1', returnUrl: 'https://app.test/account' },
      ctx,
    );
    expect(dto).toEqual({ url: 'https://portal.paddle.test/ctm_1' });
    expect(calls.get('portal')).toBe('ctm_1');
  });

  it('verifies and normalizes a webhook', async () => {
    const { client } = fakePaddle();
    const verified = await provider(client).verifyWebhook({ payload: '{}', signature: 'sig' });
    expect(verified).toEqual({
      providerEventId: 'evt_1',
      type: 'subscription.canceled',
      normalizedType: 'subscription.cancelled',
      data: { id: 'sub_1' },
    });
  });

  it('rejects a webhook the SDK cannot unmarshal', async () => {
    const { client } = fakePaddle(() => Promise.resolve(null));
    await expect(
      provider(client).verifyWebhook({ payload: '{}', signature: 'bad' }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('rejects unsupported capabilities', async () => {
    const { client } = fakePaddle();
    await expect(
      provider(client).createSubscription({ providerCustomerId: 'ctm_1', priceId: 'pri_1' }, ctx),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    await expect(provider(client).downloadInvoicePdf('in_1')).rejects.toBeInstanceOf(
      ProviderCapabilityNotSupportedError,
    );
  });
});
