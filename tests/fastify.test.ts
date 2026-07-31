import Fastify, { type FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { payableErrorReply } from '../src/presentation/fastify/helpers';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

function captureReply() {
  const captured = { status: 0, body: undefined as unknown };
  const reply = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    send(body: unknown) {
      captured.body = body;
    },
  };
  return { captured, reply: reply as unknown as FastifyReply };
}

async function makeApp(
  payable: Payable,
  options: Parameters<typeof createFastifyPayablePlugin>[1] = {},
) {
  const app = Fastify();
  await app.register(createFastifyPayablePlugin(payable, options), { prefix: '/payable' });
  await app.ready();
  return app;
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('fastify adapter', () => {
  it('rejects a checkout body larger than the route limit', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: { billable, note: 'x'.repeat(70 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it('creates a subscription checkout session', async () => {
    const provider = new FakeProvider();
    const app = await makeApp(createPayable({ providers: { stripe: provider } }));

    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: {
        billable,
        subscription: { name: 'default', price: 'price_pro', trialDays: 14 },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.trialDays).toBe(14);
    await app.close();
  });

  it('threads resolveAuthorization so authorized writes pass and absent context is denied', async () => {
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      authorization: { enabled: true },
    });
    const payload = {
      billable,
      subscription: { name: 'default', price: 'price_pro' },
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    };

    const authorized = await makeApp(payable, {
      resolveAuthorization: () => ({ allowed: true, actorId: 'admin' }),
    });
    const ok = await authorized.inject({ method: 'POST', url: '/payable/checkout', payload });
    expect(ok.statusCode).toBe(201);
    await authorized.close();

    const denied = await makeApp(payable);
    const blocked = await denied.inject({ method: 'POST', url: '/payable/checkout', payload });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('AUTHORIZATION_DENIED');
    await denied.close();
  });

  it('maps a PayableError by its domain code even when it carries a statusCode', () => {
    const error = new PayableError('denied', { code: 'AUTHORIZATION_DENIED' });
    (error as unknown as { statusCode: number }).statusCode = 503;
    const { captured, reply } = captureReply();

    payableErrorReply(error, {} as never, reply);

    expect(captured.status).toBe(403);
  });

  it('honors a framework statusCode only for a non-Payable error', () => {
    const { captured, reply } = captureReply();

    payableErrorReply({ statusCode: 503 }, {} as never, reply);

    expect(captured.status).toBe(503);
  });

  it('rejects checkout with an invalid body', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: { billable: { billableType: '', billableId: '', email: 'nope' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('rate-limits authenticated routes once the window is exceeded', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }), {
      rateLimit: { max: 1, timeWindow: '1 minute' },
    });
    const payload = {
      billable,
      subscription: { name: 'default', price: 'price_pro' },
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    };

    const first = await app.inject({ method: 'POST', url: '/payable/checkout', payload });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: 'POST', url: '/payable/checkout', payload });
    expect(second.statusCode).toBe(429);

    await app.close();
  });

  it('rate-limits customer write routes', async () => {
    const db = createTestDb();
    await migrate(db);
    const app = await makeApp(
      createPayable({
        providers: { stripe: new FakeProvider() },
        storage: new KnexStorageDriver(db, new FakeClock()),
      }),
      { rateLimit: { max: 1, timeWindow: '1 minute' } },
    );
    const payload = { billable };

    expect(
      (await app.inject({ method: 'POST', url: '/payable/customers', payload })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/payable/customers', payload })).statusCode,
    ).toBe(429);

    await app.close();
    await db.destroy();
  });

  it('rate-limits catalog write routes', async () => {
    const db = createTestDb();
    await migrate(db);
    const app = await makeApp(
      createPayable({
        providers: { stripe: new FakeProvider() },
        storage: new KnexStorageDriver(db, new FakeClock()),
      }),
      { rateLimit: { max: 1, timeWindow: '1 minute' } },
    );
    const payload = { name: 'Pro' };

    expect(
      (await app.inject({ method: 'POST', url: '/payable/products', payload })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/payable/products', payload })).statusCode,
    ).toBe(429);

    await app.close();
    await db.destroy();
  });
});
