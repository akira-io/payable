import 'reflect-metadata';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import type { NestPayableOptions } from '../src/presentation/nest/payable.constants';
import { PayableController } from '../src/presentation/nest/payable.controller';
import { PayableAuthGuard } from '../src/presentation/nest/payable-auth.guard';
import { PayableCatalogController } from '../src/presentation/nest/payable-catalog.controller';
import { PayableReadController } from '../src/presentation/nest/payable-read.controller';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

function controllerFor(payable: Payable, options: NestPayableOptions = {}): PayableController {
  return new PayableController(payable, options);
}

function catalogControllerFor(
  payable: Payable,
  options: NestPayableOptions = {},
): PayableCatalogController {
  return new PayableCatalogController(payable, options);
}

function readControllerFor(
  payable: Payable,
  options: NestPayableOptions = {},
): PayableReadController {
  return new PayableReadController(payable, options);
}

describe('nest adapter', () => {
  it('lists invoices and payments (empty without storage)', async () => {
    const controller = readControllerFor(
      createPayable({ providers: { stripe: new FakeProvider() } }),
    );
    await expect(
      controller.invoices({ headers: {} }, { billableType: 'User', billableId: '1' }),
    ).resolves.toEqual([]);
    await expect(
      controller.payments({ headers: {} }, { billableType: 'User', billableId: '1' }),
    ).resolves.toEqual([]);
  });

  it('rejects a webhook whose body is not the raw buffer', () => {
    const controller = controllerFor(createPayable({ providers: { stripe: new FakeProvider() } }));
    try {
      controller.webhook({ headers: { 'stripe-signature': 'sig' }, body: { id: 'evt_1' } });
      throw new Error('expected webhook to reject a non-buffer body');
    } catch (error) {
      expect(error).toBeInstanceOf(PayableError);
      expect((error as PayableError).code).toBe('INVALID_WEBHOOK_PAYLOAD');
    }
  });

  it('rejects checkout with an invalid body', () => {
    const controller = controllerFor(createPayable({ providers: { stripe: new FakeProvider() } }));
    try {
      controller.checkout(
        { headers: {} },
        { billable: { billableType: '', billableId: '', email: 'nope' } },
      );
      throw new Error('expected checkout to reject an invalid body');
    } catch (error) {
      expect(error).toBeInstanceOf(PayableError);
      expect((error as PayableError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('allows requests when no authenticate guard is configured', async () => {
    const moduleRef = {
      get: () => {
        throw new Error('unused');
      },
    } as unknown as ModuleRef;
    const guard = new PayableAuthGuard({}, moduleRef);
    await expect(guard.canActivate({} as ExecutionContext)).resolves.toBe(true);
  });

  it('resolves the configured guard as a container singleton', async () => {
    class DenyGuard implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }
    const singleton = new DenyGuard();
    let resolved = 0;
    const moduleRef = {
      get: (cls: new () => CanActivate) => {
        resolved += 1;
        expect(cls).toBe(DenyGuard);
        return singleton;
      },
    } as unknown as ModuleRef;
    const guard = new PayableAuthGuard({ authenticate: DenyGuard }, moduleRef);

    await expect(guard.canActivate({} as ExecutionContext)).resolves.toBe(false);
    await guard.canActivate({} as ExecutionContext);
    expect(resolved).toBe(2);
  });

  it('refunds a payment', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_nest',
      status: 'succeeded',
      currency: 'USD',
      amount: 4000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const controller = controllerFor(
      createPayable({ providers: { stripe: new FakeProvider() }, storage }),
    );

    const refund = await controller.refunds(
      { headers: {} },
      { paymentId: payment.id, amount: { amount: 4000, currency: 'USD' } },
    );
    expect(refund).toMatchObject({ amount: 4000 });
    expect(() => controller.refunds({ headers: {} }, {})).toThrowError(PayableError);

    try {
      controller.refunds(
        { headers: {} },
        { paymentId: payment.id, amount: { amount: 100, currency: 'NOPE' } },
      );
      throw new Error('expected an invalid currency to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(PayableError);
      expect((error as PayableError).code).toBe('VALIDATION_FAILED');
    }
    await db.destroy();
  });

  it('creates, reads, and updates a customer', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    const controller = controllerFor(payable);
    const readController = readControllerFor(payable);

    await expect(
      readController.getCustomer({ headers: {} }, { billableType: 'User', billableId: '1' }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });

    const created = await controller.createCustomer({ headers: {} }, { billable });
    expect(created).toMatchObject({
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
    });

    const fetched = await readController.getCustomer(
      { headers: {} },
      { billableType: 'User', billableId: '1' },
    );
    expect(fetched.email).toBe('user@example.com');

    const updated = await controller.updateCustomer({ headers: {} }, { billable, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    await db.destroy();
  });

  it('creates products and prices', async () => {
    const controller = catalogControllerFor(
      createPayable({ providers: { stripe: new FakeProvider() } }),
    );

    const product = await controller.createProduct({ headers: {} }, { name: 'Pro' });
    expect(product.providerProductId).toBe('prod_fake');

    const price = await controller.createPrice(
      { headers: {} },
      {
        providerProductId: 'prod_fake',
        amount: { amount: 9900, currency: 'USD' },
        interval: 'month',
      },
    );
    expect(price.providerPriceId).toBe('price_fake');
  });

  it('lists subscriptions, gets one, and lists refunds', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const controller = readControllerFor(payable);
    const customer = await payable.customers().create(billable);
    await storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      providerPaymentId: 'pi_r',
      status: 'succeeded',
      currency: 'USD',
      amount: 9900,
      refundedAmount: 4000,
      reference: null,
      description: null,
    });
    await storage.refunds.create({
      tenantId: null,
      paymentId: payment.id,
      provider: 'stripe',
      providerRefundId: 're_1',
      status: 'succeeded',
      currency: 'USD',
      amount: 4000,
      reason: null,
    });

    const lookup = { billableType: 'User', billableId: '1' };
    const list = await controller.subscriptions({ headers: {} }, lookup);
    expect(list[0]?.name).toBe('default');

    const one = await controller.getSubscription({ headers: {} }, 'default', lookup);
    expect(one.status).toBe('active');

    await expect(controller.getSubscription({ headers: {} }, 'nope', lookup)).rejects.toMatchObject(
      { code: 'SUBSCRIPTION_NOT_FOUND' },
    );

    const refunds = await controller.listRefunds({ headers: {} }, { paymentId: payment.id });
    expect(refunds[0]?.amount).toBe(4000);
    await db.destroy();
  });

  it('downloads an invoice pdf as a streamable file', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const controller = readControllerFor(payable);
    const customer = await payable.customers().create(billable);
    await storage.invoices.create({
      tenantId: null,
      customerId: customer.id,
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

    const file = await controller.getInvoicePdf({ headers: {} }, 'in_fake', billable);
    expect(file.options.type).toBe('application/pdf');
    expect(file.options.disposition).toContain('in_fake.pdf');

    await expect(
      controller.getInvoicePdf({ headers: {} }, 'in_fake', {
        billableType: 'User',
        billableId: '2',
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });

    await expect(
      controller.getInvoicePdf({ headers: {} }, 'in_missing', billable),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    await db.destroy();
  });
});
