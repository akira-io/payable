import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { PayableError } from '../src/domain/errors/payable-error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import type {
  NestPayableOptions,
  PayableHttpRequest,
} from '../src/presentation/nest/payable.constants';
import { PayableController } from '../src/presentation/nest/payable.controller';
import { PayableExceptionFilter } from '../src/presentation/nest/payable.exception-filter';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

function controllerFor(payable: Payable, options: NestPayableOptions = {}): PayableController {
  return new PayableController(payable, options);
}

describe('nest adapter', () => {
  it('creates a subscription checkout session', async () => {
    const provider = new FakeProvider();
    const controller = controllerFor(createPayable({ providers: { stripe: provider } }));

    const session = await controller.checkout({
      billable,
      subscription: { name: 'default', price: 'price_pro', trialDays: 14 },
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    });

    expect(session).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.trialDays).toBe(14);
  });

  it('processes a webhook from the raw body', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const controller = controllerFor(createPayable({ providers: { stripe: provider }, storage }));

    const request: PayableHttpRequest = {
      headers: { 'stripe-signature': 'sig' },
      rawBody: Buffer.from('{"id":"evt_1"}'),
    };
    const result = await controller.webhook(request);

    expect(result.duplicate).toBe(false);
    expect(provider.lastVerifyInput?.payload).toBe('{"id":"evt_1"}');
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'processed',
    );
    await db.destroy();
  });

  it('maps a PayableError through the exception filter', () => {
    const captured: { status?: number; body?: { error?: string } } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: (code: number) => ({
            json: (body: { error?: string }) => {
              captured.status = code;
              captured.body = body;
            },
          }),
        }),
      }),
    } as unknown as ArgumentsHost;

    new PayableExceptionFilter().catch(new InvalidWebhookSignatureError('stripe'), host);

    expect(captured.status).toBe(400);
    expect(captured.body?.error).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('normalizes a non-Payable error to 500 through the exception filter', () => {
    const captured: { status?: number; body?: { error?: string } } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: (code: number) => ({
            json: (body: { error?: string }) => {
              captured.status = code;
              captured.body = body;
            },
          }),
        }),
      }),
    } as unknown as ArgumentsHost;

    new PayableExceptionFilter().catch(new TypeError('boom'), host);

    expect(captured.status).toBe(500);
    expect(captured.body?.error).toBe('INTERNAL_ERROR');
  });

  it('throws not-implemented for placeholder routes', () => {
    const controller = controllerFor(createPayable({ providers: { stripe: new FakeProvider() } }));
    expect(() => controller.invoices()).toThrowError(PayableError);
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

    const refund = await controller.refunds({
      paymentId: payment.id,
      amount: { amount: 4000, currency: 'USD' },
    });
    expect(refund).toMatchObject({ amount: 4000 });
    expect(() => controller.refunds({})).toThrowError(PayableError);
    await db.destroy();
  });
});
