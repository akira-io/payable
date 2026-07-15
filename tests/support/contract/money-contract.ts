import { expect, it } from 'vitest';
import type { ContractContext } from './harness';

export function registerMoneyContract(ctx: ContractContext): void {
  it('persists payments, lists newest-first, and keeps large amounts exact', async () => {
    const { storage, clock } = ctx.harness();
    const first = await storage.payments.create({
      tenantId: null,
      customerId: 'cust_1',
      provider: 'stripe',
      providerPaymentId: 'pi_1',
      status: 'succeeded',
      currency: 'usd',
      amount: 5_000_000_000,
      refundedAmount: 0,
      reference: 'order-1',
      description: null,
    });
    clock.advance(1000);
    const second = await storage.payments.create({
      tenantId: null,
      customerId: 'cust_1',
      provider: 'stripe',
      providerPaymentId: 'pi_2',
      status: 'succeeded',
      currency: 'usd',
      amount: 100,
      refundedAmount: 0,
      reference: 'order-2',
      description: null,
    });

    expect(first.amount).toBe(5_000_000_000);
    const list = await storage.payments.listByCustomer('cust_1');
    expect(list.map((payment) => payment.id)).toEqual([second.id, first.id]);

    const updated = await storage.payments.update(first.id, { status: 'refunded' });
    expect(updated.status).toBe('refunded');
    expect(await storage.payments.findByProviderId('stripe', 'pi_1')).not.toBeNull();
  });

  it('persists refunds against a payment', async () => {
    const { storage } = ctx.harness();
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: 'cust_2',
      provider: 'stripe',
      providerPaymentId: 'pi_r',
      status: 'succeeded',
      currency: 'usd',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const refund = await storage.refunds.create({
      tenantId: null,
      paymentId: payment.id,
      provider: 'stripe',
      providerRefundId: 're_1',
      status: 'succeeded',
      currency: 'usd',
      amount: 400,
      reason: 'requested_by_customer',
    });

    expect(refund.amount).toBe(400);
    expect(await storage.refunds.listByPayment(payment.id)).toHaveLength(1);
  });

  it('reserves refund capacity only when the refunded amount is unchanged', async () => {
    const { storage } = ctx.harness();
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: 'cust_cas',
      provider: 'stripe',
      providerPaymentId: 'pi_cas',
      status: 'succeeded',
      currency: 'usd',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const reserved = await storage.payments.updateRefundedAmountIfUnchanged(payment.id, 0, {
      refundedAmount: 600,
      status: 'partially_refunded',
    });
    expect(reserved).toBe(true);

    const stale = await storage.payments.updateRefundedAmountIfUnchanged(payment.id, 0, {
      refundedAmount: 1000,
      status: 'refunded',
    });
    expect(stale).toBe(false);

    const fresh = await storage.payments.findById(payment.id);
    expect(fresh?.refundedAmount).toBe(600);
    expect(fresh?.status).toBe('partially_refunded');
  });

  it('lets exactly one concurrent refund reservation win', async () => {
    const { storage } = ctx.harness();
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: 'cust_race',
      provider: 'stripe',
      providerPaymentId: 'pi_race',
      status: 'succeeded',
      currency: 'usd',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const attempt = () =>
      storage.payments.updateRefundedAmountIfUnchanged(payment.id, 0, {
        refundedAmount: 1000,
        status: 'refunded',
      });
    const results = await Promise.all([attempt(), attempt()]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const fresh = await storage.payments.findById(payment.id);
    expect(fresh?.refundedAmount).toBe(1000);
  });

  it('scopes refund reservations to the owning tenant', async () => {
    const { storage } = ctx.harness();
    const payment = await storage.payments.create({
      tenantId: 'tenant-a',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_scoped_cas',
      status: 'succeeded',
      currency: 'usd',
      amount: 500,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const crossTenant = await storage.payments.updateRefundedAmountIfUnchanged(
      payment.id,
      0,
      { refundedAmount: 500, status: 'refunded' },
      'tenant-b',
    );
    expect(crossTenant).toBe(false);

    const owner = await storage.payments.updateRefundedAmountIfUnchanged(
      payment.id,
      0,
      { refundedAmount: 500, status: 'refunded' },
      'tenant-a',
    );
    expect(owner).toBe(true);
  });

  it('persists invoices for a customer', async () => {
    const { storage } = ctx.harness();
    const invoice = await storage.invoices.create({
      tenantId: null,
      customerId: 'cust_inv',
      subscriptionId: null,
      provider: 'stripe',
      providerInvoiceId: 'in_1',
      status: 'paid',
      currency: 'usd',
      total: 2000,
      amountPaid: 2000,
      amountDue: 0,
      number: 'INV-1',
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });

    expect(invoice.total).toBe(2000);
    expect(await storage.invoices.listByCustomer('cust_inv')).toHaveLength(1);
    expect(await storage.invoices.findByProviderId('stripe', 'in_1')).not.toBeNull();
  });

  it('scopes provider lookups by tenant', async () => {
    const { storage } = ctx.harness();
    await storage.payments.create({
      tenantId: 'tenant-a',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_a',
      status: 'succeeded',
      currency: 'usd',
      amount: 100,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    await storage.payments.create({
      tenantId: 'tenant-b',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_b',
      status: 'succeeded',
      currency: 'usd',
      amount: 200,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    expect(await storage.payments.findByProviderId('stripe', 'pi_a', 'tenant-a')).not.toBeNull();
    expect(await storage.payments.findByProviderId('stripe', 'pi_a', 'tenant-b')).toBeNull();
    const scoped = await storage.payments.list('tenant-a');
    expect(scoped.map((payment) => payment.tenantId)).toEqual(['tenant-a']);
  });

  it('commits and rolls back transactions atomically', async () => {
    const { storage } = ctx.harness();
    await storage.transaction(async (repos) => {
      await repos.customers.create({
        tenantId: null,
        provider: 'stripe',
        providerCustomerId: 'cus_tx',
        billableType: 'User',
        billableId: 'tx',
        email: 'tx@example.com',
        name: null,
        metadata: null,
      });
    });
    expect(await storage.customers.findByProviderId('stripe', 'cus_tx')).not.toBeNull();

    await expect(
      storage.transaction(async (repos) => {
        await repos.customers.create({
          tenantId: null,
          provider: 'stripe',
          providerCustomerId: 'cus_rollback',
          billableType: 'User',
          billableId: 'rollback',
          email: 'rollback@example.com',
          name: null,
          metadata: null,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await storage.customers.findByProviderId('stripe', 'cus_rollback')).toBeNull();
  });
}
