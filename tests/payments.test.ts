import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { DownloadInvoicePdfAction } from '../src/application/actions/invoices/download-invoice-pdf.action';
import { ListInvoicesAction } from '../src/application/actions/invoices/list-invoices.action';
import type { BillingDependencies } from '../src/application/builders/billing-dependencies';
import { ListPaymentsQuery } from '../src/application/queries/payments/list-payments.query';
import { ListRefundsQuery } from '../src/application/queries/refunds/list-refunds.query';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };
const stripeProvider = (stripe: Stripe) =>
  new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);

describe('StripeProvider payments', () => {
  it('charges a payment intent and forwards the idempotency key', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      paymentIntents: {
        create: (params: unknown, options: { idempotencyKey?: string }) => {
          calls.set('pi', { params, options });
          return Promise.resolve({
            id: 'pi_1',
            status: 'succeeded',
            amount: 9900,
            currency: 'usd',
          });
        },
      },
    } as unknown as Stripe;

    const dto = await stripeProvider(stripe).charge(
      { amount: Money.of(9900, 'USD'), reference: 'inv_1', description: 'one-time' },
      ctx,
    );

    expect(dto).toMatchObject({ providerPaymentId: 'pi_1', status: 'succeeded' });
    expect(dto.amount.amount()).toBe(9900);
    expect(calls.get('pi')?.params).toMatchObject({
      amount: 9900,
      currency: 'usd',
      metadata: { reference: 'inv_1' },
    });
    expect(calls.get('pi')?.options.idempotencyKey).toBe('idem-1');
  });

  it('refunds a payment intent', async () => {
    const calls = new Map<string, { params: unknown }>();
    const stripe = {
      refunds: {
        create: (params: unknown) => {
          calls.set('re', { params });
          return Promise.resolve({
            id: 're_1',
            status: 'succeeded',
            amount: 9900,
            currency: 'usd',
          });
        },
      },
    } as unknown as Stripe;

    const dto = await stripeProvider(stripe).refund(
      { providerPaymentId: 'pi_1', amount: Money.of(9900, 'USD'), reason: 'requested_by_customer' },
      ctx,
    );

    expect(dto).toMatchObject({ providerRefundId: 're_1', status: 'succeeded' });
    expect(calls.get('re')?.params).toMatchObject({ payment_intent: 'pi_1', amount: 9900 });
  });

  it('lists invoices and downloads a PDF', async () => {
    const stripe = {
      invoices: {
        list: () => ({
          autoPagingToArray: async () => [
            {
              id: 'in_1',
              status: 'paid',
              total: 9900,
              currency: 'usd',
              hosted_invoice_url: 'https://h',
              invoice_pdf: 'https://pdf.test',
            },
          ],
        }),
        retrieve: async () => ({ invoice_pdf: 'https://pdf.test' }),
      },
    } as unknown as Stripe;
    const provider = stripeProvider(stripe);

    const invoices = await provider.listInvoices({ providerCustomerId: 'cus_1', limit: 5 });
    expect(invoices[0]).toMatchObject({ providerInvoiceId: 'in_1', status: 'paid' });
    expect(invoices[0]?.total.amount()).toBe(9900);

    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    })) as unknown as typeof fetch;
    try {
      const pdf = await provider.downloadInvoicePdf('in_1');
      expect(pdf.filename).toBe('in_1.pdf');
      expect(Array.from(pdf.content)).toEqual([4, 5, 6]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('auto-paginates invoices beyond a single Stripe page', async () => {
    let requestedLimit = 0;
    const page = Array.from({ length: 150 }, (_, index) => ({
      id: `in_${index}`,
      status: 'paid',
      total: 100,
      currency: 'usd',
    }));
    const stripe = {
      invoices: {
        list: () => ({
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            requestedLimit = limit;
            return page.slice(0, limit);
          },
        }),
      },
    } as unknown as Stripe;

    const invoices = await stripeProvider(stripe).listInvoices({ providerCustomerId: 'cus_1' });
    expect(invoices).toHaveLength(150);
    expect(requestedLimit).toBe(1000);
  });

  it('throws when the invoice PDF download fails', async () => {
    const stripe = {
      invoices: { retrieve: async () => ({ invoice_pdf: 'https://pdf.test' }) },
    } as unknown as Stripe;
    const provider = stripeProvider(stripe);

    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    try {
      await expect(provider.downloadInvoicePdf('in_1')).rejects.toThrow(
        'Failed to download invoice in_1 PDF',
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('charge and refund lifecycle', () => {
  it('persists a payment, refunds it, and records history', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });
    const deps: BillingDependencies = { provider, providerName: 'stripe', clock, storage };

    const payment = await payable.customer(billable).charge({
      amount: Money.of(9900, 'USD'),
      reference: 'inv_1',
    });
    expect(payment).toMatchObject({
      providerPaymentId: 'pi_fake',
      status: 'succeeded',
      amount: 9900,
    });
    expect(provider.lastChargeCtx?.idempotencyKey).toBe('charge:stripe:User:1:inv_1:9900:USD');
    expect(await new ListPaymentsQuery(deps).run(billable)).toHaveLength(1);

    const refund = await payable.refund({ paymentId: payment.id, amount: Money.of(9900, 'USD') });
    expect(refund).toMatchObject({ providerRefundId: 're_fake_1', amount: 9900 });
    expect(provider.lastRefundInput?.providerPaymentId).toBe('pi_fake');

    const updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(9900);
    expect(updated?.status).toBe('refunded');
    expect(await new ListRefundsQuery(deps).run(payment.id)).toHaveLength(1);
    expect(await new ListInvoicesAction(deps).handle(billable)).toHaveLength(1);
    expect((await new DownloadInvoicePdfAction(deps).handle('in_fake')).filename).toBe(
      'in_fake.pdf',
    );
    await db.destroy();
  });

  it('records a partial refund then completes it', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(9900, 'USD'),
      reference: 'inv_partial',
    });

    await payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') });
    let updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(4000);
    expect(updated?.status).toBe('partially_refunded');

    await payable.refund({ paymentId: payment.id, amount: Money.of(5900, 'USD') });
    updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(9900);
    expect(updated?.status).toBe('refunded');
    await db.destroy();
  });

  it('rejects a refund exceeding the remaining balance', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(5000, 'USD'),
      reference: 'inv_over',
    });

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(6000, 'USD') }),
    ).rejects.toThrow('exceeds remaining');

    await payable.refund({ paymentId: payment.id, amount: Money.of(5000, 'USD') });
    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(1, 'USD') }),
    ).rejects.toThrow('not refundable');

    const updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(5000);
    await db.destroy();
  });

  it('rejects a refund for a payment that already exhausted its balance via partials', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(5000, 'USD'),
      reference: 'inv_partial_over',
    });

    await payable.refund({ paymentId: payment.id, amount: Money.of(3000, 'USD') });
    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(2500, 'USD') }),
    ).rejects.toThrow('exceeds remaining');

    const updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(3000);
    await db.destroy();
  });

  it('rejects a refund whose currency differs from the payment currency', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(9900, 'USD'),
      reference: 'inv_mismatch',
    });

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(9900, 'EUR') }),
    ).rejects.toThrow('does not match payment currency');

    const untouched = await storage.payments.findById(payment.id);
    expect(untouched?.refundedAmount).toBe(0);
    expect(untouched?.status).toBe('succeeded');
    await db.destroy();
  });

  it('rejects a refund without a storage driver', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    await expect(payable.refund({ paymentId: 'pay_x' })).rejects.toThrow(
      'requires a storage driver',
    );
  });

  it('rejects a refund for an unknown payment', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    await expect(payable.refund({ paymentId: 'missing' })).rejects.toThrow('Payment not found');
    await db.destroy();
  });
});
