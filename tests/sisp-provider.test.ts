import { describe, expect, it } from 'vitest';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import { Money } from '../src/domain/value-objects/money';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import type {
  SispClient,
  SispHttpRequestInfo,
  SispTransactionRecord,
} from '../src/infrastructure/providers/sisp/sisp-types';

const ctx: OperationContext = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

const OPTIONS: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  database: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
};

const GATEWAY = 'https://mc.vinti4net.cv/Client_VbV_v2/biz_vbv_clientdata.jsp';

interface RecordedRefund {
  amount: number | null;
  full: boolean;
  reason?: string;
}

function fakeSisp() {
  const calls: { payment?: SispHttpRequestInfo; refund?: RecordedRefund } = {};
  const base: SispTransactionRecord = {
    id: 7,
    merchant_ref: 'R-existing',
    amount: 1500,
    currency: 'CVE',
    status: 'completed',
    transaction_id: 'TID-1',
  };
  const client: SispClient = {
    config: { generators: { merchantReference: () => 'R-DEFAULT' } },
    handlers: {
      handlePayment: async (request) => {
        calls.payment = request;
        return { type: 'html', status: 200, html: `<form>${request.body.merchantRef}</form>` };
      },
    },
    driver: () => ({ paymentEndpoint: () => GATEWAY }),
    models: {
      transactions: {
        findByRef: async (ref) => (ref === 'missing' ? null : { ...base, merchant_ref: ref }),
      },
    },
    refund: (transaction) => {
      const recorded: RecordedRefund = { amount: null, full: false };
      const builder = {
        amount(value: number) {
          recorded.amount = value;
          return builder;
        },
        full() {
          recorded.full = true;
          return builder;
        },
        reason(reason: string) {
          recorded.reason = reason;
          return builder;
        },
        async process() {
          calls.refund = recorded;
          return { ...transaction, status: 'refunded' };
        },
      };
      return builder;
    },
    validateCallback: (payload) => payload.ok === true,
    handlePaymentCallback: async (payload) => ({
      ...base,
      merchant_ref: String(payload.merchantRef ?? 'R-cb'),
    }),
  };
  return { client, calls };
}

describe('SispProvider', () => {
  it('advertises only checkout and refunds capabilities', () => {
    const { client } = fakeSisp();
    const capabilities = new SispProvider(OPTIONS, client).capabilities();
    expect(capabilities.has('checkout')).toBe(true);
    expect(capabilities.has('refunds')).toBe(true);
    expect(capabilities.has('subscriptions')).toBe(false);
    expect(capabilities.has('customers')).toBe(false);
    expect(capabilities.has('catalog')).toBe(false);
  });

  it('builds a persisted checkout form using the SISP merchant reference generator', async () => {
    const { client, calls } = fakeSisp();
    const dto = await new SispProvider(OPTIONS, client).createCheckoutSession(
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
    expect(body.merchantRef).toBe('R-DEFAULT');
    expect(body.amount).toBe(1500);
    expect(body.items).toEqual([
      { product_name: 'Payment', quantity: 1, unit_price: 1500, total_price: 1500 },
    ]);
    expect(dto.id).toBe(body.merchantRef);
    expect(dto.url).toBe(GATEWAY);
    expect(dto.html).toContain(String(body.merchantRef));
  });

  it('rejects subscription checkout', async () => {
    const { client } = fakeSisp();
    await expect(
      new SispProvider(OPTIONS, client).createCheckoutSession(
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
      new SispProvider(OPTIONS, client).createCheckoutSession(
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

  it('refunds the full amount by looking up the SISP transaction', async () => {
    const { client, calls } = fakeSisp();
    const dto = await new SispProvider(OPTIONS, client).refund({ providerPaymentId: 'R-abc' }, ctx);
    expect(calls.refund).toEqual({ amount: null, full: true });
    expect(dto.providerRefundId).toBe('TID-1');
    expect(dto.status).toBe('succeeded');
    expect(dto.amount.amount()).toBe(150000);
    expect(dto.amount.currency()).toBe('CVE');
  });

  it('refunds a partial amount in SISP major units', async () => {
    const { client, calls } = fakeSisp();
    const dto = await new SispProvider(OPTIONS, client).refund(
      { providerPaymentId: 'R-abc', amount: Money.of(50000, 'CVE'), reason: 'partial' },
      ctx,
    );
    expect(calls.refund).toEqual({ amount: 500, full: false, reason: 'partial' });
    expect(dto.amount.amount()).toBe(50000);
    expect(dto.amount.currency()).toBe('CVE');
  });

  it('throws when the transaction to refund is missing', async () => {
    const { client } = fakeSisp();
    await expect(
      new SispProvider(OPTIONS, client).refund({ providerPaymentId: 'missing' }, ctx),
    ).rejects.toMatchObject({ code: 'PROVIDER_SISP_TRANSACTION_NOT_FOUND' });
  });

  it('verifies callbacks and normalizes the processed transaction', async () => {
    const { client } = fakeSisp();
    const provider = new SispProvider(OPTIONS, client);
    expect(await provider.verifyCallback({ ok: true })).toBe(true);
    expect(await provider.verifyCallback({ ok: false })).toBe(false);
    const result = await provider.handleRedirectCallback({ merchantRef: 'R-cb' });
    expect(result).toEqual({ providerPaymentId: 'R-cb', status: 'succeeded' });
  });

  it('never serializes the wrapped client', () => {
    const { client } = fakeSisp();
    const provider = new SispProvider(OPTIONS, client);
    expect(provider.toJSON()).toEqual({ name: 'sisp' });
    expect(JSON.stringify(provider)).toBe('{"name":"sisp"}');
  });
});
