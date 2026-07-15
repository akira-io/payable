import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  isIssuingAuthorizationCapable,
  isIssuingCardCapable,
  isIssuingCardholderCapable,
  isIssuingTransactionCapable,
} from '../src/domain/contracts/issuing-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { StripeIssuingProvider } from '../src/infrastructure/providers/stripe/stripe-issuing-provider';
import { fakeStripeIssuing } from './support/stripe-issuing';

const context = { correlationId: 'corr-1', idempotencyKey: 'issuing-idem-1' };
const address = {
  line1: '1 Main Street',
  city: 'New York',
  region: 'NY',
  postalCode: '10001',
  country: 'US',
};

function provider(client: Stripe): StripeIssuingProvider {
  return new StripeIssuingProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Issuing provider', () => {
  it('advertises all complete Issuing capabilities without exposing secrets', () => {
    const { client } = fakeStripeIssuing();
    const instance = provider(client);

    expect(instance.capabilities()).toEqual(
      new Set(['cardholders', 'cards', 'authorizations', 'transactions']),
    );
    expect(isIssuingCardholderCapable(instance)).toBe(true);
    expect(isIssuingCardCapable(instance)).toBe(true);
    expect(isIssuingAuthorizationCapable(instance)).toBe(true);
    expect(isIssuingTransactionCapable(instance)).toBe(true);
    const configured = new StripeIssuingProvider({ secretKey: 'sk_live_private' });
    expect(JSON.stringify(configured)).not.toContain('sk_live_private');
    expect(inspect(configured)).not.toContain('sk_live_private');
  });

  it('creates and retrieves a normalized cardholder', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    const cardholder = await instance.createIssuingCardholder(
      {
        type: 'individual',
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+15555550100',
        reference: 'employee-1',
        billingAddress: address,
      },
      context,
    );
    await instance.retrieveIssuingCardholder('ich_1');

    expect(calls.cardholdersCreate).toHaveBeenCalledWith(
      {
        type: 'individual',
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone_number: '+15555550100',
        billing: {
          address: {
            line1: '1 Main Street',
            line2: undefined,
            city: 'New York',
            state: 'NY',
            postal_code: '10001',
            country: 'US',
          },
        },
        metadata: { payable_reference: 'employee-1' },
      },
      { idempotencyKey: 'issuing-idem-1' },
    );
    expect(calls.cardholdersRetrieve).toHaveBeenCalledWith('ich_1');
    expect(cardholder).toMatchObject({
      providerCardholderId: 'ich_1',
      type: 'individual',
      status: 'active',
    });
  });

  it('requires a billing address before creating a Stripe cardholder', async () => {
    const { client, calls } = fakeStripeIssuing();

    await expect(
      provider(client).createIssuingCardholder(
        { type: 'business', name: 'Acme', reference: 'company-1' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(calls.cardholdersCreate).not.toHaveBeenCalled();
  });

  it('creates virtual and physical cards with generic controls', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    await instance.createIssuingCard(
      {
        providerCardholderId: 'ich_1',
        form: 'virtual',
        label: 'Travel',
        spendingLimit: Money.of(50_000, 'USD'),
      },
      context,
    );
    expect(calls.cardsCreate).toHaveBeenLastCalledWith(
      {
        cardholder: 'ich_1',
        currency: 'usd',
        type: 'virtual',
        metadata: { payable_label: 'Travel' },
        spending_controls: {
          spending_limits: [{ amount: 50_000, interval: 'per_authorization' }],
        },
      },
      { idempotencyKey: 'issuing-idem-1' },
    );

    await instance.createIssuingCard(
      {
        providerCardholderId: 'ich_1',
        form: 'physical',
        currency: 'EUR',
        shipping: { name: 'Jane Doe', phone: '+352000000', address },
      },
      context,
    );
    expect(calls.cardsCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currency: 'eur',
        type: 'physical',
        shipping: expect.objectContaining({ name: 'Jane Doe', phone_number: '+352000000' }),
      }),
      { idempotencyKey: 'issuing-idem-1' },
    );
  });

  it('lists, retrieves, and updates cards with bounded pagination', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    const cards = await instance.listIssuingCards({
      providerCardholderId: 'ich_1',
      status: 'active',
      limit: 250,
    });
    await instance.retrieveIssuingCard('ic_1');
    await instance.updateIssuingCardStatus('ic_1', 'inactive', context);
    await instance.updateIssuingCardStatus('ic_1', 'canceled', context);

    expect(calls.cardsList).toHaveBeenCalledWith({
      cardholder: 'ich_1',
      status: 'active',
      limit: 100,
    });
    expect(calls.cardsPage.autoPagingToArray).toHaveBeenCalledWith({ limit: 250 });
    expect(calls.cardsRetrieve).toHaveBeenCalledWith('ic_1');
    expect(calls.cardsUpdate).toHaveBeenNthCalledWith(
      1,
      'ic_1',
      { status: 'inactive' },
      { idempotencyKey: 'issuing-idem-1' },
    );
    expect(calls.cardsUpdate).toHaveBeenNthCalledWith(
      2,
      'ic_1',
      { status: 'canceled' },
      { idempotencyKey: 'issuing-idem-1' },
    );
    expect(cards[0]?.lastFour).toBe('4242');
  });

  it('rejects unsupported card inputs before calling Stripe', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    await expect(
      instance.createIssuingCard({ providerCardholderId: 'ich_1', form: 'virtual' }, context),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    await expect(
      instance.createIssuingCard(
        { providerCardholderId: 'ich_1', form: 'physical', currency: 'USD' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    await expect(
      instance.createIssuingCard(
        {
          providerCardholderId: 'ich_1',
          form: 'virtual',
          currency: 'EUR',
          spendingLimit: Money.of(1000, 'USD'),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    await expect(
      instance.updateIssuingCardStatus('ic_1', 'blocked', context),
    ).rejects.toMatchObject({
      code: 'PROVIDER_OPERATION_UNSUPPORTED',
    });
    expect(calls.cardsCreate).not.toHaveBeenCalled();
    expect(calls.cardsUpdate).not.toHaveBeenCalled();
  });

  it('lists, retrieves, approves, and declines authorizations', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    await instance.listIssuingAuthorizations({
      providerCardId: 'ic_1',
      status: 'pending',
      limit: 125,
    });
    await instance.retrieveIssuingAuthorization('iauth_1');
    await instance.respondIssuingAuthorization(
      { providerAuthorizationId: 'iauth_1', decision: 'approve' },
      context,
    );
    const declined = await instance.respondIssuingAuthorization(
      { providerAuthorizationId: 'iauth_2', decision: 'decline' },
      context,
    );

    expect(calls.authorizationsList).toHaveBeenCalledWith({
      card: 'ic_1',
      status: 'pending',
      limit: 100,
    });
    expect(calls.authorizationsRetrieve).toHaveBeenCalledWith('iauth_1');
    expect(calls.authorizationsApprove).toHaveBeenCalledWith(
      'iauth_1',
      {},
      { idempotencyKey: 'issuing-idem-1' },
    );
    expect(calls.authorizationsDecline).toHaveBeenCalledWith(
      'iauth_2',
      {},
      { idempotencyKey: 'issuing-idem-1' },
    );
    expect(declined.status).toBe('declined');
  });

  it('lists and retrieves issuing transactions with generic filters', async () => {
    const { client, calls } = fakeStripeIssuing();
    const instance = provider(client);

    const transactions = await instance.listIssuingTransactions({
      providerCardId: 'ic_1',
      providerAuthorizationId: 'iauth_1',
      limit: 120,
    });
    await instance.retrieveIssuingTransaction('ipi_1');

    expect(calls.transactionsList).toHaveBeenCalledWith({ card: 'ic_1', limit: 100 });
    expect(calls.transactionsRetrieve).toHaveBeenCalledWith('ipi_1');
    expect(transactions).toHaveLength(1);
    expect('providerAuthorizationId' in (transactions[0] ?? {})).toBe(false);
  });

  it('normalizes Stripe Issuing errors', async () => {
    const { client, calls } = fakeStripeIssuing();
    calls.cardsRetrieve.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'Card not found',
    });

    await expect(provider(client).retrieveIssuingCard('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-issuing' }),
    });
  });
});
