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

function malformedReversal(
  change: (reversal: Stripe.TransferReversal) => void,
): Stripe.TransferReversal {
  const reversal = stripeMarketplaceTransferReversal();
  change(reversal);
  return reversal;
}

const malformedResponseCases: ReadonlyArray<
  readonly [string, string, (reversal: Stripe.TransferReversal) => void]
> = [
  ['missing reversal id', 'id', (reversal) => Reflect.deleteProperty(reversal, 'id')],
  ['null reversal id', 'id', (reversal) => Reflect.set(reversal, 'id', null)],
  ['empty reversal id', 'id', (reversal) => Reflect.set(reversal, 'id', ' ')],
  ['non-string reversal id', 'id', (reversal) => Reflect.set(reversal, 'id', 123)],
  ['missing transfer', 'transfer', (reversal) => Reflect.deleteProperty(reversal, 'transfer')],
  ['null transfer', 'transfer', (reversal) => Reflect.set(reversal, 'transfer', null)],
  ['empty transfer', 'transfer', (reversal) => Reflect.set(reversal, 'transfer', ' ')],
  ['non-object transfer', 'transfer', (reversal) => Reflect.set(reversal, 'transfer', 123)],
  ['expanded transfer without id', 'transfer', (reversal) => Reflect.set(reversal, 'transfer', {})],
  [
    'expanded transfer with null id',
    'transfer',
    (reversal) => Reflect.set(reversal, 'transfer', { id: null }),
  ],
  [
    'expanded transfer with empty id',
    'transfer',
    (reversal) => Reflect.set(reversal, 'transfer', { id: ' ' }),
  ],
  [
    'expanded transfer with non-string id',
    'transfer',
    (reversal) => Reflect.set(reversal, 'transfer', { id: 123 }),
  ],
  ['missing amount', 'amount', (reversal) => Reflect.deleteProperty(reversal, 'amount')],
  ['null amount', 'amount', (reversal) => Reflect.set(reversal, 'amount', null)],
  ['empty amount', 'amount', (reversal) => Reflect.set(reversal, 'amount', '')],
  ['non-numeric amount', 'amount', (reversal) => Reflect.set(reversal, 'amount', '400')],
  ['missing currency', 'currency', (reversal) => Reflect.deleteProperty(reversal, 'currency')],
  ['null currency', 'currency', (reversal) => Reflect.set(reversal, 'currency', null)],
  ['empty currency', 'currency', (reversal) => Reflect.set(reversal, 'currency', ' ')],
  ['non-string currency', 'currency', (reversal) => Reflect.set(reversal, 'currency', 123)],
  [
    'missing created timestamp',
    'created',
    (reversal) => Reflect.deleteProperty(reversal, 'created'),
  ],
  ['null created timestamp', 'created', (reversal) => Reflect.set(reversal, 'created', null)],
  ['empty created timestamp', 'created', (reversal) => Reflect.set(reversal, 'created', '')],
  [
    'non-numeric created timestamp',
    'created',
    (reversal) => Reflect.set(reversal, 'created', '1725000300'),
  ],
];

describe('Stripe Marketplace transfer reversal responses', () => {
  it.each(
    malformedResponseCases,
  )('rejects a create response with %s', async (_description, field, change) => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersCreateReversal.mockResolvedValue(malformedReversal(change));

    const operation = provider(client).createMarketplaceTransferReversal(
      { providerTransferId: 'tr_1' },
      context,
    );

    await expect(operation).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect', field }),
    });
  });

  it('rejects a retrieve response with a malformed expanded transfer', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transfersRetrieveReversal.mockResolvedValue(
      malformedReversal((reversal) => Reflect.set(reversal, 'transfer', { id: null })),
    );

    const operation = provider(client).retrieveMarketplaceTransferReversal('tr_1', 'trr_1');

    await expect(operation).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect', field: 'transfer' }),
    });
  });

  it('rejects a malformed reversal in a list response', async () => {
    const { client, calls } = fakeStripeMarketplace();
    calls.transferReversalsPage.autoPagingToArray.mockResolvedValue([
      malformedReversal((reversal) => Reflect.set(reversal, 'created', null)),
    ]);

    const operation = provider(client).listMarketplaceTransferReversals({
      providerTransferId: 'tr_1',
    });

    await expect(operation).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      context: expect.objectContaining({ provider: 'stripe-connect', field: 'created' }),
    });
  });
});
