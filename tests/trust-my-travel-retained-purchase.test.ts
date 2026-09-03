import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { FakeClock } from '../src/support/clock/fake-clock';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const BASE_OPTIONS = {
  path: 'merchant',
  apiToken: 'private-api-token',
  channelId: 2452,
  channelSecret: 'private-channel-secret',
  vaultReferenceSecrets: ['stable-vault-reference-secret-32-bytes'] as const,
  currency: 'EUR',
  environment: 'test' as const,
  baseUrl: 'https://tmt.test',
  clock: new FakeClock(NOW),
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function channel(id = 2452, accountType = 'protected-processing', accountMode = 'test') {
  return {
    id,
    uuid: `channel-${id}`,
    name: 'Test',
    slug: 'test',
    account_type: accountType,
    account_mode: accountMode,
    protection_type: 'trust-my-travel',
    currencies: 'EUR',
    language: 'enGB',
    channel_status: 'active',
    statement_period: 'month',
    cardholder_present: false,
    server_to_server: false,
  };
}

function jwt(): string {
  const issuedAt = Math.floor(NOW.getTime() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iat: issuedAt, exp: issuedAt + 900 })}.signature`;
}

function vaultTransaction() {
  return {
    id: 731,
    status: 'complete',
    total: 0,
    total_remaining: 0,
    currencies: 'EUR',
    channels: 2452,
    bookings: [],
    transaction_types: 'vault',
    token: 'authoritative-vault-token',
    card_types: 'visa',
    last_four_digits: '4242',
  };
}

async function createPaymentMethod(fetch: typeof globalThis.fetch): Promise<string> {
  const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, fetch });
  const setup = await provider.createPaymentMethodSetup(
    {
      providerCustomerId: 'customer-1',
      usage: 'off_session',
      currency: 'EUR',
      returnUrl: 'https://merchant.test/return',
    },
    { correlationId: 'correlation-1' },
  );
  const sessionId = new URL(setup.checkoutUrl ?? '').searchParams.get('session_id');
  const confirmed = await provider.confirmPaymentMethodSetup({
    providerSetupId: setup.providerSetupId,
    providerReturn: `session_id=${sessionId}&transaction_id=731&token=authoritative-vault-token&status=Approved`,
  });
  return confirmed.providerPaymentMethodId ?? '';
}

describe('Trust My Travel retained purchase', () => {
  it('creates the minimal off-session linked transaction after authoritative checks', async () => {
    const postedBodies: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/channels/2452')) return response(channel());
      if (url.endsWith('/token/cardvaultuser')) return response({ token: jwt() });
      if (url.endsWith('/transactions/731')) return response(vaultTransaction());
      if (url.includes('/category-one-declines?')) return response([]);
      if (url.endsWith('/transactions') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(String(init.body)));
        return response({
          id: 901,
          status: 'complete',
          total: 5000,
          total_remaining: 5000,
          currencies: 'EUR',
          channels: 2452,
          bookings: [{ id: 44, currencies: 'EUR', total: 5000 }],
          transaction_types: 'retained_purchase',
          linked_id: 731,
        });
      }
      return response({ error: 'unexpected route' }, 404);
    });
    const paymentMethodId = await createPaymentMethod(fetch);
    const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, fetch });

    const result = await provider.charge(
      {
        amount: Money.of(5000, 'EUR'),
        paymentMethodId,
        offSession: true,
        reference: 'renewal-1',
        providerData: {
          bookings: [
            {
              id: 44,
              currencies: 'EUR',
              total: 5000,
              cvv: 'must-not-leave-process',
              token: 'must-not-leave-process',
              linked_id: 999,
            },
          ],
        },
      },
      { correlationId: 'correlation-2', idempotencyKey: 'charge-1' },
    );

    expect(result.status).toBe('succeeded');
    expect(result.providerPaymentId).toBe('901');
    expect(postedBodies).toEqual([
      {
        channels: 2452,
        currencies: 'EUR',
        total: 5000,
        transaction_types: 'retained_purchase',
        bookings: [{ id: 44, currencies: 'EUR', total: 5000 }],
        linked_id: 731,
      },
    ]);
    const serialized = JSON.stringify(postedBodies);
    expect(serialized).not.toContain('private-api-token');
    expect(serialized).not.toContain('private-channel-secret');
    expect(serialized).not.toContain('cvv');
    expect(serialized).not.toContain('psp');
    expect(serialized).not.toContain('"token"');
  });

  it('permits another channel only when currency and account type match', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/channels/2452')) return response(channel());
      if (url.endsWith('/channels/3000')) return response(channel(3000));
      if (url.endsWith('/token/cardvaultuser')) return response({ token: jwt() });
      if (url.endsWith('/transactions/731')) return response(vaultTransaction());
      if (url.includes('/category-one-declines?')) return response([]);
      if (url.endsWith('/transactions') && init?.method === 'POST') {
        return response({
          id: 902,
          status: 'complete',
          total: 5000,
          currencies: 'EUR',
          channels: 3000,
          bookings: [{ id: 45, currencies: 'EUR', total: 5000 }],
          transaction_types: 'retained_purchase',
          linked_id: 731,
        });
      }
      return response({}, 404);
    });
    const paymentMethodId = await createPaymentMethod(fetch);
    const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, channelId: 3000, fetch });

    const result = await provider.charge(
      {
        amount: Money.of(5000, 'EUR'),
        paymentMethodId,
        offSession: true,
        providerData: { bookings: [{ id: 45, currencies: 'EUR', total: 5000 }] },
      },
      { correlationId: 'correlation-2', idempotencyKey: 'charge-2' },
    );
    expect(result.providerPaymentId).toBe('902');
  });

  it.each([
    ['trust', 'test'],
    ['protected-processing', 'live'],
  ])('rejects %s/%s scope mismatch before retained purchase mutation', async (accountType, accountMode) => {
    let mutationCount = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/channels/2452')) return response(channel());
      if (url.endsWith('/channels/3000')) {
        return response(channel(3000, accountType, accountMode));
      }
      if (url.endsWith('/token/cardvaultuser')) return response({ token: jwt() });
      if (url.endsWith('/transactions/731')) return response(vaultTransaction());
      if (url.endsWith('/transactions') && init?.method === 'POST') mutationCount += 1;
      return response([]);
    });
    const paymentMethodId = await createPaymentMethod(fetch);
    const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, channelId: 3000, fetch });

    await expect(
      provider.charge(
        {
          amount: Money.of(5000, 'EUR'),
          paymentMethodId,
          offSession: true,
          providerData: { bookings: [{ id: 45, currencies: 'EUR', total: 5000 }] },
        },
        { correlationId: 'correlation-2', idempotencyKey: 'charge-3' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_RETAINED_PURCHASE_SCOPE_MISMATCH' });
    expect(mutationCount).toBe(0);
  });

  it('permanently rejects an audited category-one declined vault before mutation', async () => {
    let mutationCount = 0;
    const auditUrls: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/channels/2452')) return response(channel());
      if (url.endsWith('/token/cardvaultuser')) return response({ token: jwt() });
      if (url.endsWith('/transactions/731')) return response(vaultTransaction());
      if (url.includes('/category-one-declines?')) {
        auditUrls.push(url);
        return response([
          { id: 12, transaction_id: 731, token: 'provider-token', reason: 'Card lost' },
        ]);
      }
      if (url.endsWith('/transactions') && init?.method === 'POST') mutationCount += 1;
      return response({});
    });
    const paymentMethodId = await createPaymentMethod(fetch);
    const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, fetch });

    const charge = () =>
      provider.charge(
        {
          amount: Money.of(5000, 'EUR'),
          paymentMethodId,
          offSession: true,
          providerData: {
            bookings: [
              {
                id: 44,
                currencies: 'EUR',
                total: 5000,
                cvv: 'must-not-leave-process',
                token: 'must-not-leave-process',
                linked_id: 999,
              },
            ],
          },
        },
        { correlationId: 'correlation-2', idempotencyKey: 'charge-4' },
      );
    await expect(charge()).rejects.toMatchObject({
      code: 'PROVIDER_PAYMENT_METHOD_PERMANENTLY_INVALID',
    });
    await expect(charge()).rejects.toMatchObject({
      code: 'PROVIDER_PAYMENT_METHOD_PERMANENTLY_INVALID',
    });
    expect(mutationCount).toBe(0);
    expect(auditUrls).toHaveLength(2);
    expect(auditUrls.every((url) => url.endsWith('?transaction_id=731&per_page=1'))).toBe(true);
  });

  it('requires an opaque payment method, off-session mode and exact booking allocations', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new TrustMyTravelProvider({ ...BASE_OPTIONS, fetch });

    await expect(
      provider.charge(
        {
          amount: Money.of(5000, 'EUR'),
          paymentMethodId: '731',
          offSession: false,
          providerData: { cvv: '123', bookings: [] },
        },
        { correlationId: 'correlation-2' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_RETAINED_PURCHASE_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
