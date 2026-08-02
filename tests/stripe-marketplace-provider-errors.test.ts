import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { CreateMarketplaceTransferInput } from '../src/domain/dtos/marketplace.dto';
import { Money } from '../src/domain/value-objects/money';
import { StripeMarketplaceProvider } from '../src/infrastructure/providers/stripe/stripe-marketplace-provider';
import { fakeStripeMarketplace } from './support/stripe-marketplace';

const context = { correlationId: 'corr-1', idempotencyKey: 'marketplace-idem-1' };

function provider(client: Stripe): StripeMarketplaceProvider {
  return new StripeMarketplaceProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Marketplace provider errors', () => {
  it.each([
    'pi_1',
    'cs_1',
    'ch_',
    '',
  ])('rejects a non-Charge source identifier %j before calling Stripe', async (providerChargeId) => {
    const { client, calls } = fakeStripeMarketplace();
    const input: CreateMarketplaceTransferInput = {
      destinationProviderAccountId: 'acct_1',
      amount: Money.of(1_000, 'USD'),
      sourceReference: { type: 'charge', providerChargeId },
    };

    await expect(provider(client).createMarketplaceTransfer(input, context)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect' }),
    });
    expect(calls.transfersCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-Charge runtime source type before calling Stripe', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);
    const input = {
      destinationProviderAccountId: 'acct_1',
      amount: Money.of(1_000, 'USD'),
      sourceReference: { type: 'payment_intent', providerChargeId: 'pi_1' },
    };

    await expect(
      Reflect.apply(instance.createMarketplaceTransfer, instance, [input, context]),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect' }),
    });
    expect(calls.transfersCreate).not.toHaveBeenCalled();
  });

  it('normalizes Stripe Connect errors', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.accountsRetrieve.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'Connected account not found',
    });

    await expect(provider(client).retrieveMarketplaceAccount('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect' }),
    });
  });
});
