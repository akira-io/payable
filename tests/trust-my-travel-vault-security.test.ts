import { describe, expect, it, vi } from 'vitest';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { TrustMyTravelVaultReferenceCodec } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-vault-reference';
import { FakeClock } from '../src/support/clock/fake-clock';

const NOW = new Date('2030-01-02T03:04:05.000Z');

function response(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe('Trust My Travel vault security', () => {
  it('rejects an explicitly configured weak reference secret', () => {
    expect(
      () =>
        new TrustMyTravelProvider({
          path: 'merchant',
          apiToken: 'api-token',
          channelId: 2452,
          channelSecret: 'channel-secret',
          vaultReferenceSecrets: [''],
          currency: 'EUR',
          environment: 'test',
        }),
    ).toThrow('at least 32 bytes');
  });

  it('rejects a CardVaulter JWT issued beyond the clock-skew allowance', async () => {
    const issuedAt = Math.floor(NOW.getTime() / 1000) + 61;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256' })}.${encode({ iat: issuedAt, exp: issuedAt + 900 })}.signature`;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          id: 2452,
          currencies: 'EUR',
          account_mode: 'test',
          account_type: 'protected-processing',
        }),
      )
      .mockResolvedValueOnce(response({ token }));
    const provider = new TrustMyTravelProvider({
      path: 'merchant',
      apiToken: 'api-token',
      channelId: 2452,
      channelSecret: 'channel-secret',
      currency: 'EUR',
      environment: 'test',
      fetch,
      clock: new FakeClock(NOW),
    });

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
    ).rejects.toMatchObject({
      code: 'PROVIDER_TMT_CARD_VAULT_TOKEN_INVALID',
    });
  });

  it('decrypts references with retained rotation keys', () => {
    const previous = new TrustMyTravelVaultReferenceCodec([
      'previous-vault-reference-secret-32-bytes',
    ]);
    const reference = previous.sealPaymentMethod({
      transactionId: 731,
      sitePath: 'merchant',
      channelId: 2452,
      currency: 'EUR',
      accountType: 'protected-processing',
      environment: 'test',
      createdAt: NOW.toISOString(),
    });
    const rotated = new TrustMyTravelVaultReferenceCodec([
      'active-vault-reference-secret-32-bytes',
      'previous-vault-reference-secret-32-bytes',
    ]);

    expect(rotated.openPaymentMethod(reference).transactionId).toBe(731);
    expect(() =>
      new TrustMyTravelVaultReferenceCodec([
        'active-vault-reference-secret-32-bytes',
      ]).openPaymentMethod(reference),
    ).toThrowError();
  });
});
