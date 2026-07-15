import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  isMarketplaceAccountCapable,
  isMarketplaceOnboardingCapable,
  isMarketplacePayoutCapable,
  isMarketplaceTransferCapable,
} from '../src/domain/contracts/marketplace-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { StripeMarketplaceProvider } from '../src/infrastructure/providers/stripe/stripe-marketplace-provider';
import { fakeStripeMarketplace } from './support/stripe-marketplace';

const context = { correlationId: 'corr-1', idempotencyKey: 'marketplace-idem-1' };

function provider(client: Stripe): StripeMarketplaceProvider {
  return new StripeMarketplaceProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Marketplace provider', () => {
  it('advertises all complete capabilities without exposing secrets', () => {
    const { client } = fakeStripeMarketplace();
    const instance = provider(client);

    expect(instance.capabilities()).toEqual(
      new Set(['accounts', 'onboarding', 'transfers', 'payouts']),
    );
    expect(isMarketplaceAccountCapable(instance)).toBe(true);
    expect(isMarketplaceOnboardingCapable(instance)).toBe(true);
    expect(isMarketplaceTransferCapable(instance)).toBe(true);
    expect(isMarketplacePayoutCapable(instance)).toBe(true);
    const configured = new StripeMarketplaceProvider({ secretKey: 'sk_live_private' });
    expect(JSON.stringify(configured)).not.toContain('sk_live_private');
    expect(inspect(configured)).not.toContain('sk_live_private');
  });

  it('keeps scanning later pages until a filtered account match appears', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const filler = Array.from({ length: 149 }, (_, index) => ({
      id: `acct_filler_${index}`,
      type: 'express',
      business_type: 'company',
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { currently_due: [], past_due: [], pending_verification: [] },
    }));
    const lateMatch = {
      id: 'acct_late',
      type: 'express',
      business_type: 'company',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { currently_due: ['tos'], past_due: [], pending_verification: [] },
    };
    calls.accountsList.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield* [...filler, lateMatch];
      },
    });

    const accounts = await provider(client).listMarketplaceAccounts({
      status: 'restricted',
      limit: 1,
    });

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerAccountId).toBe('acct_late');
  });

  it('creates modern connected accounts and maps requirements', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    const created = await instance.createMarketplaceAccount(
      {
        type: 'business',
        country: 'us',
        email: 'seller@example.com',
        reference: 'seller-1',
      },
      context,
    );
    const retrieved = await instance.retrieveMarketplaceAccount('acct_1');

    expect(calls.accountsCreate).toHaveBeenCalledWith(
      {
        business_type: 'company',
        country: 'US',
        email: 'seller@example.com',
        controller: {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'express' },
        },
        metadata: { reference: 'seller-1' },
      },
      { idempotencyKey: 'marketplace-idem-1' },
    );
    expect(calls.accountsRetrieve).toHaveBeenCalledWith('acct_1');
    expect(created).toMatchObject({
      providerAccountId: 'acct_1',
      type: 'business',
      status: 'active',
      requirementsDue: [],
    });
    expect(retrieved.chargesEnabled).toBe(true);
  });

  it('lists accounts with bounded pagination and generic status filtering', async () => {
    const { client, calls } = fakeStripeMarketplace();

    const accounts = await provider(client).listMarketplaceAccounts({
      status: 'restricted',
      limit: 250,
    });

    expect(calls.accountsList).toHaveBeenCalledWith({ limit: 100 });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      providerAccountId: 'acct_2',
      status: 'restricted',
      requirementsDue: ['individual.verification.document'],
    });
  });

  it('creates an onboarding link with idempotency', async () => {
    const { client, calls } = fakeStripeMarketplace();

    const link = await provider(client).createMarketplaceOnboardingLink(
      {
        providerAccountId: 'acct_1',
        refreshUrl: 'https://app.test/refresh',
        returnUrl: 'https://app.test/return',
      },
      { ...context, idempotencyKey: 'onboard-1' },
    );

    expect(calls.accountLinksCreate).toHaveBeenCalledWith(
      {
        account: 'acct_1',
        refresh_url: 'https://app.test/refresh',
        return_url: 'https://app.test/return',
        type: 'account_onboarding',
      },
      { idempotencyKey: 'onboard-1' },
    );
    expect(link).toEqual({
      providerAccountId: 'acct_1',
      url: 'https://connect.stripe.test/onboarding',
      expiresAt: new Date(1_725_003_600_000),
    });
  });

  it('creates, lists, and retrieves transfers from the platform balance', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    const created = await instance.createMarketplaceTransfer(
      {
        destinationProviderAccountId: 'acct_1',
        amount: Money.of(12_345, 'USD'),
        reference: 'order-1',
      },
      context,
    );
    await instance.listMarketplaceTransfers({ destinationProviderAccountId: 'acct_1', limit: 120 });
    await instance.retrieveMarketplaceTransfer('tr_1');

    expect(calls.transfersCreate).toHaveBeenCalledWith(
      {
        amount: 12_345,
        currency: 'usd',
        destination: 'acct_1',
        metadata: { reference: 'order-1' },
      },
      { idempotencyKey: 'marketplace-idem-1' },
    );
    expect(calls.transfersList).toHaveBeenCalledWith({ destination: 'acct_1', limit: 100 });
    expect(calls.transfersPage.autoPagingToArray).toHaveBeenCalledWith({ limit: 120 });
    expect(calls.transfersRetrieve).toHaveBeenCalledWith('tr_1');
    expect(created.status).toBe('completed');
    expect(created.amount.amount()).toBe(12_345);
  });

  it('creates and reads payouts only in the connected account context', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    const created = await instance.createMarketplacePayout(
      {
        providerAccountId: 'acct_1',
        amount: Money.of(9_000, 'USD'),
        reference: 'settlement-1',
      },
      context,
    );
    await instance.listMarketplacePayouts({ providerAccountId: 'acct_1', limit: 140 });
    await instance.retrieveMarketplacePayout('acct_1', 'po_1');

    expect(calls.payoutsCreate).toHaveBeenCalledWith(
      {
        amount: 9_000,
        currency: 'usd',
        metadata: { reference: 'settlement-1' },
      },
      { idempotencyKey: 'marketplace-idem-1', stripeAccount: 'acct_1' },
    );
    expect(calls.payoutsList).toHaveBeenCalledWith({ limit: 100 }, { stripeAccount: 'acct_1' });
    expect(calls.payoutsPage.autoPagingToArray).toHaveBeenCalledWith({ limit: 140 });
    expect(calls.payoutsRetrieve).toHaveBeenCalledWith('po_1', {}, { stripeAccount: 'acct_1' });
    expect(created).toMatchObject({
      providerAccountId: 'acct_1',
      status: 'pending',
      arrivalAt: new Date(1_725_086_400_000),
    });
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
