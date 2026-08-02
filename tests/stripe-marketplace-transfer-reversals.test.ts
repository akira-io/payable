import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeMarketplaceProvider } from '../src/infrastructure/providers/stripe/stripe-marketplace-provider';
import {
  fakeStripeMarketplace,
  stripeMarketplaceTransferReversal,
} from './support/stripe-marketplace';

const context = { correlationId: 'corr-1', idempotencyKey: 'marketplace-idem-1' };

function provider(client: Stripe): StripeMarketplaceProvider {
  return new StripeMarketplaceProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Marketplace transfer reversals', () => {
  it('creates a full reversal without an amount and forwards idempotency', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    const created = await instance.createMarketplaceTransferReversal(
      { providerTransferId: 'tr_1', reference: 'order-1-reversal' },
      { ...context, idempotencyKey: 'reverse-full-1' },
    );

    expect(calls.transfersCreateReversal).toHaveBeenCalledWith(
      'tr_1',
      { metadata: { reference: 'order-1-reversal' } },
      { idempotencyKey: 'reverse-full-1' },
    );
    expect(created).toMatchObject({
      providerReversalId: 'trr_1',
      providerTransferId: 'tr_1',
      reference: 'order-1-reversal',
      createdAt: new Date(1_725_000_300_000),
    });
    expect(created.amount.amount()).toBe(400);
    expect(created.amount.currency()).toBe('USD');
  });

  it('preserves partial reversal amounts and idempotency keys', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    await instance.createMarketplaceTransferReversal(
      { providerTransferId: 'tr_1', amount: 150 },
      { ...context, idempotencyKey: 'reverse-partial-1' },
    );
    await instance.createMarketplaceTransferReversal(
      { providerTransferId: 'tr_1', amount: 250 },
      { ...context, idempotencyKey: 'reverse-partial-2' },
    );

    expect(calls.transfersCreateReversal).toHaveBeenNthCalledWith(
      1,
      'tr_1',
      { amount: 150 },
      { idempotencyKey: 'reverse-partial-1' },
    );
    expect(calls.transfersCreateReversal).toHaveBeenNthCalledWith(
      2,
      'tr_1',
      { amount: 250 },
      { idempotencyKey: 'reverse-partial-2' },
    );
  });

  it('retrieves and lists reversals with bounded pagination', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    await instance.retrieveMarketplaceTransferReversal('tr_1', 'trr_1');
    await instance.listMarketplaceTransferReversals({
      providerTransferId: 'tr_1',
      limit: 240,
    });

    expect(calls.transfersRetrieveReversal).toHaveBeenCalledWith('tr_1', 'trr_1');
    expect(calls.transfersListReversals).toHaveBeenCalledWith('tr_1', { limit: 100 });
    expect(calls.transferReversalsPage.autoPagingToArray).toHaveBeenCalledWith({ limit: 240 });
  });

  it('normalizes an expanded transfer without exposing the provider object', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersRetrieveReversal.mockResolvedValue(
      stripeMarketplaceTransferReversal({
        transfer: { id: 'tr_expanded' } as Stripe.Transfer,
      }),
    );

    const reversal = await provider(client).retrieveMarketplaceTransferReversal('tr_1', 'trr_1');

    expect(reversal.providerTransferId).toBe('tr_expanded');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid reversal amount %j before calling Stripe', async (amount) => {
    const { client, calls } = fakeStripeMarketplace();

    await expect(
      provider(client).createMarketplaceTransferReversal(
        { providerTransferId: 'tr_1', amount },
        context,
      ),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });
    expect(calls.transfersCreateReversal).not.toHaveBeenCalled();
  });

  it('rejects empty reversal identifiers and invalid list limits locally', async () => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    await expect(
      instance.createMarketplaceTransferReversal({ providerTransferId: ' ' }, context),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });
    await expect(instance.retrieveMarketplaceTransferReversal('tr_1', ' ')).rejects.toMatchObject({
      code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID',
    });
    await expect(
      instance.listMarketplaceTransferReversals({ providerTransferId: 'tr_1', limit: 0 }),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });
    await expect(
      instance.listMarketplaceTransferReversals({ providerTransferId: 'tr_1', limit: 1.5 }),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });
    await expect(
      instance.listMarketplaceTransferReversals({
        providerTransferId: 'tr_1',
        limit: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });

    expect(calls.transfersCreateReversal).not.toHaveBeenCalled();
    expect(calls.transfersRetrieveReversal).not.toHaveBeenCalled();
    expect(calls.transfersListReversals).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
    123,
  ])('normalizes non-string reversal identifier %j before calling Stripe', async (invalidIdentifier) => {
    const { client, calls } = fakeStripeMarketplace();
    const instance = provider(client);

    await expect(
      Reflect.apply(instance.createMarketplaceTransferReversal, instance, [
        { providerTransferId: invalidIdentifier },
        context,
      ]),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });
    await expect(
      Reflect.apply(instance.retrieveMarketplaceTransferReversal, instance, [
        'tr_1',
        invalidIdentifier,
      ]),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID' });

    expect(calls.transfersCreateReversal).not.toHaveBeenCalled();
    expect(calls.transfersRetrieveReversal).not.toHaveBeenCalled();
  });

  it('rejects a reversal response without a transfer identifier', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersRetrieveReversal.mockResolvedValue(
      stripeMarketplaceTransferReversal({ transfer: { id: '' } as Stripe.Transfer }),
    );

    const operation = provider(client).retrieveMarketplaceTransferReversal('tr_1', 'trr_1');

    await expect(operation).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect' }),
    });
  });

  it.each([
    ['balance_insufficient', 'MARKETPLACE_TRANSFER_REVERSAL_INSUFFICIENT_BALANCE'],
    ['amount_too_large', 'MARKETPLACE_TRANSFER_REVERSAL_AMOUNT_EXCEEDED'],
  ] as const)('maps Stripe reversal code %s to %s', async (stripeCode, payableCode) => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersCreateReversal.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      code: stripeCode,
      message: 'provider request rejected',
    });

    await expect(
      provider(client).createMarketplaceTransferReversal(
        { providerTransferId: 'tr_1', amount: 400 },
        context,
      ),
    ).rejects.toMatchObject({
      code: payableCode,
      context: {
        provider: 'stripe-connect',
        stripeType: 'StripeInvalidRequestError',
        stripeCode,
      },
    });
  });

  it('maps other invalid reversal requests without parsing the message', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersCreateReversal.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'text must not drive classification',
    });

    await expect(
      provider(client).createMarketplaceTransferReversal({ providerTransferId: 'tr_1' }, context),
    ).rejects.toMatchObject({
      code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID',
      context: expect.objectContaining({
        provider: 'stripe-connect',
        stripeType: 'StripeInvalidRequestError',
      }),
    });
  });
});
