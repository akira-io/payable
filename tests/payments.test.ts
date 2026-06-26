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
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
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

  it('forwards a zero-decimal currency amount without scaling', async () => {
    const calls = new Map<string, { params: unknown }>();
    const stripe = {
      paymentIntents: {
        create: (params: unknown) => {
          calls.set('pi', { params });
          return Promise.resolve({
            id: 'pi_jpy',
            status: 'succeeded',
            amount: 1000,
            currency: 'jpy',
          });
        },
      },
    } as unknown as Stripe;

    const dto = await stripeProvider(stripe).charge({ amount: Money.of(1000, 'JPY') }, ctx);

    expect(dto.amount.amount()).toBe(1000);
    expect(dto.amount.currency()).toBe('JPY');
    expect(calls.get('pi')?.params).toMatchObject({ amount: 1000, currency: 'jpy' });
  });

  it('rescales an amount whose Stripe exponent differs from the domain exponent', async () => {
    const calls = new Map<string, { params: { amount?: number; currency?: string } }>();
    const stripe = {
      paymentIntents: {
        create: (params: { amount?: number; currency?: string }) => {
          calls.set('pi', { params });
          return Promise.resolve({
            id: 'pi_isk',
            status: 'succeeded',
            amount: 100000,
            currency: 'isk',
          });
        },
      },
    } as unknown as Stripe;

    // ISK: domain exponent 0, Stripe exponent 2 -> 1000 kr is sent as 100000.
    const dto = await stripeProvider(stripe).charge({ amount: Money.of(1000, 'ISK') }, ctx);
    expect(calls.get('pi')?.params).toMatchObject({ amount: 100000, currency: 'isk' });
    expect(dto.amount.amount()).toBe(1000);
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

  it('drops an unrecognized refund reason instead of forwarding it', async () => {
    const calls = new Map<string, { params: { reason?: string } }>();
    const stripe = {
      refunds: {
        create: (params: { reason?: string }) => {
          calls.set('re', { params });
          return Promise.resolve({ id: 're_2', status: 'succeeded', amount: 100, currency: 'usd' });
        },
      },
    } as unknown as Stripe;

    await stripeProvider(stripe).refund(
      { providerPaymentId: 'pi_1', amount: Money.of(100, 'USD'), reason: 'not-a-stripe-reason' },
      ctx,
    );
    expect(calls.get('re')?.params.reason).toBeUndefined();
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

    const invoices = await stripeProvider(stripe).listInvoices({
      providerCustomerId: 'cus_1',
      limit: 1000,
    });
    expect(invoices).toHaveLength(150);
    expect(requestedLimit).toBe(1000);
  });

  it('defaults to a conservative invoice limit when none is given', async () => {
    let requestedLimit = 0;
    const stripe = {
      invoices: {
        list: () => ({
          autoPagingToArray: async ({ limit }: { limit: number }) => {
            requestedLimit = limit;
            return [];
          },
        }),
      },
    } as unknown as Stripe;

    await stripeProvider(stripe).listInvoices({ providerCustomerId: 'cus_1' });
    expect(requestedLimit).toBe(100);
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

  it('rejects a non-https invoice PDF URL', async () => {
    const stripe = {
      invoices: { retrieve: async () => ({ invoice_pdf: 'http://insecure.test/in.pdf' }) },
    } as unknown as Stripe;
    await expect(stripeProvider(stripe).downloadInvoicePdf('in_1')).rejects.toMatchObject({
      code: 'INVOICE_PDF_UNTRUSTED_URL',
    });
  });

  it('wraps a network failure or timeout downloading the invoice PDF', async () => {
    const stripe = {
      invoices: { retrieve: async () => ({ invoice_pdf: 'https://pdf.test' }) },
    } as unknown as Stripe;
    const provider = stripeProvider(stripe);
    const original = globalThis.fetch;

    globalThis.fetch = (() => Promise.reject(new TypeError('connection reset'))) as typeof fetch;
    try {
      await expect(provider.downloadInvoicePdf('in_1')).rejects.toMatchObject({
        code: 'INVOICE_PDF_DOWNLOAD_FAILED',
        context: { reason: 'transport' },
      });

      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      globalThis.fetch = (() => Promise.reject(timeout)) as typeof fetch;
      await expect(provider.downloadInvoicePdf('in_1')).rejects.toMatchObject({
        code: 'INVOICE_PDF_DOWNLOAD_FAILED',
        context: { reason: 'timeout' },
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects an invoice PDF that exceeds the size limit', async () => {
    const stripe = {
      invoices: { retrieve: async () => ({ invoice_pdf: 'https://pdf.test/in.pdf' }) },
    } as unknown as Stripe;
    const provider = stripeProvider(stripe);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      headers: { get: () => String(50 * 1024 * 1024) },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    try {
      await expect(provider.downloadInvoicePdf('in_1')).rejects.toMatchObject({
        code: 'INVOICE_PDF_TOO_LARGE',
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('idempotent charge', () => {
  it('replays a duplicate charge without calling the provider again', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      clock,
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    const first = await payable
      .customer(billable)
      .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_dup' });
    const second = await payable
      .customer(billable)
      .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_dup' });

    expect(provider.chargeCalls).toBe(1);
    expect(second.providerPaymentId).toBe(first.providerPaymentId);
    await db.destroy();
  });

  it('does not auto-deduplicate when the idempotency strategy is manual', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      clock,
      idempotency: { strategy: 'manual', store: new KnexIdempotencyRepository(db, clock) },
    });

    const first = await payable
      .customer(billable)
      .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_m' });
    const second = await payable
      .customer(billable)
      .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_m' });

    expect(second.id).not.toBe(first.id);
    expect(provider.chargeCalls).toBe(2);
    await db.destroy();
  });

  it('rejects a charge whose provider currency diverges from the request', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();
    provider.charge = async (_input, ctx) => {
      provider.lastChargeCtx = ctx;
      return { providerPaymentId: 'pi_x', status: 'succeeded', amount: Money.of(9900, 'EUR') };
    };
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    await expect(
      payable
        .customer(billable)
        .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_mismatch' }),
    ).rejects.toThrow(/does not match requested currency/);
    await db.destroy();
  });
});

describe('refund idempotency key', () => {
  it('keys the remaining balance when the amount is omitted', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_x',
      status: 'succeeded',
      currency: 'USD',
      amount: 10_000,
      refundedAmount: 4_000,
      reference: null,
      description: null,
    });

    await payable.refund({ paymentId: payment.id });

    expect(provider.lastRefundCtx?.idempotencyKey).toBe('refund::stripe:pi_x:6000:USD');
    await db.destroy();
  });

  it('appends a reference segment so an identical amount issues a distinct refund', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      clock,
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_ref',
      status: 'succeeded',
      currency: 'USD',
      amount: 10_000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    await payable.refund({ paymentId: payment.id, amount: Money.of(4_000, 'USD') });
    const replay = await payable.refund({ paymentId: payment.id, amount: Money.of(4_000, 'USD') });
    const afterReplay = await storage.payments.findById(payment.id);
    expect(afterReplay?.refundedAmount).toBe(4_000);
    expect(provider.refundCalls).toBe(1);

    const distinct = await payable.refund({
      paymentId: payment.id,
      amount: Money.of(4_000, 'USD'),
      reference: 'second',
    });
    expect(distinct.id).not.toBe(replay.id);
    expect(provider.lastRefundCtx?.idempotencyKey).toBe('refund::stripe:pi_ref:4000:USD:second');
    const afterDistinct = await storage.payments.findById(payment.id);
    expect(afterDistinct?.refundedAmount).toBe(8_000);
    await db.destroy();
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
      providerPaymentId: 'pi_fake_1',
      status: 'succeeded',
      amount: 9900,
    });
    expect(provider.lastChargeCtx?.idempotencyKey).toBe('charge::stripe:User:1:inv_1:9900:USD');
    expect(await new ListPaymentsQuery(deps).run(billable)).toHaveLength(1);

    const refund = await payable.refund({ paymentId: payment.id, amount: Money.of(9900, 'USD') });
    expect(refund).toMatchObject({ providerRefundId: 're_fake_1', amount: 9900 });
    expect(provider.lastRefundInput?.providerPaymentId).toBe('pi_fake_1');

    const updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(9900);
    expect(updated?.status).toBe('refunded');
    expect(await new ListRefundsQuery(deps).run(payment.id)).toHaveLength(1);
    const auditEntries = await storage.auditLogs.list({ resourceType: 'payment' });
    expect(auditEntries.some((entry) => entry.action === 'payment.refunded')).toBe(true);
    expect(await new ListInvoicesAction(deps).handle(billable)).toHaveLength(1);
    const owner = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      null,
    );
    await storage.invoices.create({
      tenantId: null,
      customerId: owner?.id ?? '',
      subscriptionId: null,
      provider: 'stripe',
      providerInvoiceId: 'in_fake',
      status: 'paid',
      currency: 'USD',
      total: 9900,
      amountPaid: 9900,
      amountDue: 0,
      number: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });
    expect((await new DownloadInvoicePdfAction(deps).handle('in_fake')).filename).toBe(
      'in_fake.pdf',
    );
    await expect(new DownloadInvoicePdfAction(deps).handle('in_foreign')).rejects.toThrow(
      'Invoice not found',
    );
    await db.destroy();
  });

  it('rejects a non-positive or non-integer invoice limit at the action boundary', async () => {
    const provider = new FakeProvider();
    const deps: BillingDependencies = { provider, providerName: 'stripe', clock: new FakeClock() };
    const action = new ListInvoicesAction(deps);

    await expect(action.handle(billable, 0)).rejects.toThrow(/positive integer/);
    await expect(action.handle(billable, -5)).rejects.toThrow(/positive integer/);
    await expect(action.handle(billable, 2.5)).rejects.toThrow(/positive integer/);
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

  it('recomputes the refunded amount from the persisted value across refunds', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(9900, 'USD'),
      reference: 'inv_tx',
    });

    await payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') });
    await payable.refund({ paymentId: payment.id, amount: Money.of(3000, 'USD') });

    const updated = await storage.payments.findById(payment.id);
    expect(updated?.refundedAmount).toBe(7000);
    expect(updated?.status).toBe('partially_refunded');
    await db.destroy();
  });

  it('rejects a refund whose currency differs from the payment currency', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const payment = await payable.customer(billable).charge({
      amount: Money.of(9900, 'USD'),
      reference: 'inv_mismatch',
    });

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(9900, 'EUR') }),
    ).rejects.toThrow('does not match payment currency');

    expect(provider.refundCalls).toBe(0);
    const untouched = await storage.payments.findById(payment.id);
    expect(untouched?.refundedAmount).toBe(0);
    expect(untouched?.status).toBe('succeeded');
    await db.destroy();
  });

  it('routes a refund to the provider that owns the payment in a multi-provider setup', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const stripe = new FakeProvider();
    const paddle = new FakeProvider();
    const payable = createPayable({ providers: { stripe, paddle }, storage, clock });

    const payment = await payable
      .customer(billable, 'paddle')
      .charge({ amount: Money.of(9900, 'USD'), reference: 'inv_multi' });

    await payable.refund({ paymentId: payment.id });

    expect(paddle.refundCalls).toBe(1);
    expect(stripe.refundCalls).toBe(0);
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

  it('scopes ListRefundsQuery by tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      clock,
      tenant: { enabled: true },
    });

    const payment = await payable
      .customer(billable, undefined, 'tenant-a')
      .charge({ amount: Money.of(4000, 'USD') });
    await payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') }, 'tenant-a');

    const ownDeps: BillingDependencies = {
      provider,
      providerName: 'stripe',
      clock,
      storage,
      tenantId: 'tenant-a',
    };
    const otherDeps: BillingDependencies = {
      provider,
      providerName: 'stripe',
      clock,
      storage,
      tenantId: 'tenant-b',
    };
    expect(await new ListRefundsQuery(ownDeps).run(payment.id)).toHaveLength(1);
    expect(await new ListRefundsQuery(otherDeps).run(payment.id)).toHaveLength(0);
    await db.destroy();
  });

  it('refunds under tenancy and blocks cross-tenant refunds', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage,
      clock,
      tenant: { enabled: true },
    });

    const payment = await payable
      .customer(billable, undefined, 'tenant-a')
      .charge({ amount: Money.of(4000, 'USD') });

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') }),
    ).rejects.toThrow('tenant id is required');

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') }, 'tenant-b'),
    ).rejects.toThrow('Payment not found');

    const refund = await payable.refund(
      { paymentId: payment.id, amount: Money.of(4000, 'USD') },
      'tenant-a',
    );
    expect(refund.amount).toBe(4000);
    const updated = await storage.payments.findById(payment.id, 'tenant-a');
    expect(updated?.refundedAmount).toBe(4000);
    await db.destroy();
  });
});
