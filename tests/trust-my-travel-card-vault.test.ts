import { describe, expect, it, vi } from 'vitest';
import { isPaymentMethodSetupCapable, isPaymentMethodSetupConfirmationCapable } from '../src/index';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { FakeClock } from '../src/support/clock/fake-clock';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const OPTIONS = {
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

const channel = {
  id: 2452,
  uuid: 'channel-uuid',
  name: 'Test',
  slug: 'test',
  account_type: 'protected-processing',
  account_mode: 'test',
  protection_type: 'trust-my-travel',
  currencies: 'EUR',
  language: 'enGB',
  channel_status: 'active',
  statement_period: 'month',
  cardholder_present: false,
  server_to_server: false,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function jwt(expiresInSeconds = 900): string {
  const issuedAt = Math.floor(NOW.getTime() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iat: issuedAt, exp: issuedAt + expiresInSeconds })}.signature`;
}

function vaultTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 731,
    status: 'complete',
    total: 0,
    total_remaining: 0,
    currencies: 'EUR',
    channels: 2452,
    bookings: [],
    transaction_types: 'vault',
    card_types: 'visa',
    last_four_digits: '4242',
    token: 'authoritative-vault-token',
    ...overrides,
  };
}

describe('Trust My Travel CardVaulter', () => {
  it('exposes only the dedicated short-lived vault JWT in a pinned hosted URL', async () => {
    const cardVaultJwt = jwt();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: cardVaultJwt }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    expect(isPaymentMethodSetupCapable(provider)).toBe(true);
    expect(isPaymentMethodSetupConfirmationCapable(provider)).toBe(true);
    const setup = await provider.createPaymentMethodSetup(
      {
        providerCustomerId: 'customer-1',
        usage: 'off_session',
        currency: 'EUR',
        returnUrl: 'https://merchant.test/payment-method/return',
        reference: 'consent-1',
      },
      { correlationId: 'correlation-1', idempotencyKey: 'setup-1' },
    );

    const url = new URL(setup.checkoutUrl ?? '');
    expect(url.origin + url.pathname).toBe('https://vault.tmtprotects.com/1.8.0/');
    expect(url.searchParams.get('auth')).toBe(cardVaultJwt);
    expect(url.searchParams.get('channels')).toBe('2452');
    expect(url.searchParams.get('currency')).toBe('EUR');
    expect(url.searchParams.get('env')).toBe('test');
    expect(url.searchParams.get('redirect')).toBe('https://merchant.test/payment-method/return');
    expect(url.searchParams.get('session_id')).toMatch(/^[a-f0-9]{32}$/u);
    expect(setup.providerSetupId).not.toContain(url.searchParams.get('session_id') ?? 'missing');
    expect(JSON.stringify(setup)).not.toContain(OPTIONS.apiToken);
    expect(JSON.stringify(setup)).not.toContain(OPTIONS.channelSecret);
    expect(JSON.stringify(setup).toLowerCase()).not.toContain('cvv');
  });

  it('rejects a CardVaulter JWT whose lifetime exceeds fifteen minutes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt(901) }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    await expect(
      provider.createPaymentMethodSetup(
        {
          providerCustomerId: 'customer-1',
          usage: 'off_session',
          currency: 'EUR',
          returnUrl: 'https://merchant.test/return',
        },
        { correlationId: 'correlation-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CARD_VAULT_TOKEN_INVALID' });
  });

  it('redacts credential and provider identifiers from CardVaulter API errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(
        response(
          { token: OPTIONS.apiToken, transaction_id: 731, secret: OPTIONS.channelSecret },
          500,
        ),
      );
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });

    const failure = await provider
      .createPaymentMethodSetup(
        {
          providerCustomerId: 'customer-1',
          usage: 'off_session',
          currency: 'EUR',
          returnUrl: 'https://merchant.test/return',
        },
        { correlationId: 'correlation-1' },
      )
      .catch((error) => JSON.stringify(error));
    expect(failure).not.toContain(OPTIONS.apiToken);
    expect(failure).not.toContain(OPTIONS.channelSecret);
    expect(failure).not.toContain('731');
  });

  it('ignores a forged return status and confirms the vault through the transaction API', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt() }))
      .mockResolvedValueOnce(response(vaultTransaction()));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
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
      providerReturn: `session_id=${sessionId}&transaction_id=731&token=authoritative-vault-token&status=Failed&last_four=9999`,
    });

    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.providerPaymentMethodId).toMatch(/^tmtpm1\./u);
    expect(confirmed.providerPaymentMethodId).not.toContain('731');
    expect(confirmed.paymentMethod).toEqual({
      type: 'card',
      brand: 'visa',
      lastFour: '4242',
      expiryMonth: null,
      expiryYear: null,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://tmt.test/merchant/wp-json/tmt/v2/transactions/731',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a transaction ID substituted from another vault session', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt() }))
      .mockResolvedValueOnce(response(vaultTransaction()));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
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

    await expect(
      provider.confirmPaymentMethodSetup({
        providerSetupId: setup.providerSetupId,
        providerReturn: `session_id=${sessionId}&transaction_id=731&token=another-vault-token`,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CARD_VAULT_TRANSACTION_INVALID' });
  });

  it('rejects a return from another setup before querying a transaction', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt() }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const setup = await provider.createPaymentMethodSetup(
      {
        providerCustomerId: 'customer-1',
        usage: 'off_session',
        currency: 'EUR',
        returnUrl: 'https://merchant.test/return',
      },
      { correlationId: 'correlation-1' },
    );

    await expect(
      provider.confirmPaymentMethodSetup({
        providerSetupId: setup.providerSetupId,
        providerReturn: 'session_id=attacker&transaction_id=731&status=Approved',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CARD_VAULT_RETURN_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not claim an unverified setup state or local cancellation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt() }));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
    const setup = await provider.createPaymentMethodSetup(
      {
        providerCustomerId: 'customer-1',
        usage: 'off_session',
        currency: 'EUR',
        returnUrl: 'https://merchant.test/return',
      },
      { correlationId: 'correlation-1' },
    );

    await expect(provider.retrievePaymentMethodSetup(setup.providerSetupId)).resolves.toMatchObject(
      {
        status: 'unknown',
      },
    );
    await expect(
      provider.cancelPaymentMethodSetup(setup.providerSetupId, { correlationId: 'correlation-1' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CARD_VAULT_CANCEL_UNSUPPORTED' });
  });

  it('rejects an authoritative transaction outside the expected vault scope', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(channel))
      .mockResolvedValueOnce(response({ token: jwt() }))
      .mockResolvedValueOnce(response(vaultTransaction({ currencies: 'USD' })));
    const provider = new TrustMyTravelProvider({ ...OPTIONS, fetch });
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

    await expect(
      provider.confirmPaymentMethodSetup({
        providerSetupId: setup.providerSetupId,
        providerReturn: `session_id=${sessionId}&transaction_id=731&token=authoritative-vault-token&status=Approved`,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TMT_CARD_VAULT_TRANSACTION_INVALID' });
  });
});
