import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
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

    const session = await controller.checkout(
      { headers: {} },
      {
        billable,
        subscription: { name: 'default', price: 'price_pro', trialDays: 14 },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      },
    );

    expect(session).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.trialDays).toBe(14);
  });

  it('threads resolveAuthorization so authorized writes pass and absent context is denied', async () => {
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      authorization: { enabled: true },
    });
    const body = {
      billable,
      subscription: { name: 'default', price: 'price_pro' },
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    };

    const authorized = controllerFor(payable, {
      resolveAuthorization: () => ({ allowed: true, actorId: 'admin' }),
    });
    const session = await authorized.checkout({ headers: {} }, body);
    expect(session).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });

    const denied = controllerFor(payable);
    await expect(denied.checkout({ headers: {} }, body)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
  });

  it('resolves the signature header per provider on mixed routes', async () => {
    const db = createTestDb();
    await migrate(db);
    const stripe = new FakeProvider();
    stripe.verifyResult = {
      providerEventId: 'evt_stripe',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: {},
    };
    const paddle = new FakeProvider();
    paddle.verifyResult = {
      providerEventId: 'evt_paddle',
      type: 'subscription.canceled',
      normalizedType: 'subscription.cancelled',
      data: {},
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const controller = controllerFor(createPayable({ providers: { stripe, paddle }, storage }));

    await controller.webhookForProvider(
      {
        headers: { 'stripe-signature': 'stripe-sig', 'paddle-signature': 'wrong' },
        rawBody: Buffer.from('{"id":"evt_stripe"}'),
      },
      'stripe',
    );
    expect(stripe.lastVerifyInput?.signature).toBe('stripe-sig');

    await controller.webhookForProvider(
      {
        headers: { 'paddle-signature': 'paddle-sig', 'stripe-signature': 'wrong' },
        rawBody: Buffer.from('{"id":"evt_paddle"}'),
      },
      'paddle',
    );
    expect(paddle.lastVerifyInput?.signature).toBe('paddle-sig');
    await db.destroy();
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

  it('preserves a framework HttpException status instead of remapping to 500', () => {
    const captured: { status?: number; body?: unknown } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: (code: number) => ({
            json: (body: unknown) => {
              captured.status = code;
              captured.body = body;
            },
          }),
        }),
      }),
    } as unknown as ArgumentsHost;
    const httpException = {
      getStatus: () => 401,
      getResponse: () => ({ statusCode: 401, message: 'Unauthorized' }),
    };

    new PayableExceptionFilter().catch(httpException, host);

    expect(captured.status).toBe(401);
    expect(captured.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it('replies through the Express-style HTTP adapter when one is available', () => {
    const captured: { status?: number; body?: { error?: string } } = {};
    const response = {
      status: (code: number) => ({
        json: (body: { error?: string }) => {
          captured.status = code;
          captured.body = body;
        },
      }),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const adapterHost = {
      httpAdapter: {
        reply: (res: typeof response, body: { error?: string }, status: number) => {
          res.status(status).json(body);
        },
      },
    } as unknown as HttpAdapterHost;

    new PayableExceptionFilter(adapterHost).catch(new InvalidWebhookSignatureError('stripe'), host);

    expect(captured.status).toBe(400);
    expect(captured.body?.error).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('replies through a Fastify-style HTTP adapter without Express methods', () => {
    const captured: { status?: number; body?: { error?: string } } = {};
    const fastifyReply = {
      code: (status: number) => ({
        send: (body: { error?: string }) => {
          captured.status = status;
          captured.body = body;
        },
      }),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => fastifyReply }),
    } as unknown as ArgumentsHost;
    const adapterHost = {
      httpAdapter: {
        reply: (reply: typeof fastifyReply, body: { error?: string }, status: number) => {
          reply.code(status).send(body);
        },
      },
    } as unknown as HttpAdapterHost;

    new PayableExceptionFilter(adapterHost).catch(new InvalidWebhookSignatureError('stripe'), host);

    expect(captured.status).toBe(400);
    expect(captured.body?.error).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('preserves framework HttpException mapping through the adapter', () => {
    const captured: { status?: number; body?: unknown } = {};
    const host = {
      switchToHttp: () => ({ getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;
    const adapterHost = {
      httpAdapter: {
        reply: (_res: unknown, body: unknown, status: number) => {
          captured.status = status;
          captured.body = body;
        },
      },
    } as unknown as HttpAdapterHost;
    const httpException = {
      getStatus: () => 401,
      getResponse: () => ({ statusCode: 401, message: 'Unauthorized' }),
    };

    new PayableExceptionFilter(adapterHost).catch(httpException, host);

    expect(captured.status).toBe(401);
    expect(captured.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });
});
