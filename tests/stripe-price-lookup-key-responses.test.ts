import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { toPriceDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import {
  createStripeCatalogClient,
  createStripeCatalogPrice,
} from './support/stripe-catalog-client';

const operationContext = {
  correlationId: 'corr-response',
  idempotencyKey: `payable:catalog:v1:${'b'.repeat(64)}`,
};

function priceInput(lookupKey = 'monthly') {
  return {
    providerProductId: 'prod_1',
    unitAmount: Money.of(9900, 'USD'),
    lookupKey,
  };
}

function stripeProvider(lookupKey: unknown) {
  const catalog = createStripeCatalogClient(
    createStripeCatalogPrice({ lookup_key: lookupKey as string | null }),
  );
  return {
    ...catalog,
    provider: new StripeProvider(
      { secretKey: 'sk_test', webhookSecret: 'wh_test' },
      catalog.client,
    ),
  };
}

function expectInvalidLookupResponse(promise: Promise<unknown>, providerPriceId = 'price_1') {
  return expect(promise).rejects.toMatchObject({
    code: 'PROVIDER_RESPONSE_INVALID',
    context: { provider: 'stripe', field: 'lookup_key', providerPriceId },
  });
}

describe('Stripe price lookup-key responses', () => {
  it('maps absent and matching lookup keys', () => {
    expect(toPriceDTO(createStripeCatalogPrice())).toMatchObject({ lookupKey: null });
    expect(toPriceDTO(createStripeCatalogPrice({ lookup_key: 'monthly' }))).toMatchObject({
      lookupKey: 'monthly',
    });
  });

  it('rejects a malformed runtime lookup key', () => {
    let error: unknown;
    try {
      toPriceDTO(createStripeCatalogPrice({ lookup_key: 12 as never }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
      context: { provider: 'stripe', field: 'lookup_key', providerPriceId: 'price_1' },
    });
  });

  it('rejects missing and mismatched lookup keys after creation', async () => {
    await expectInvalidLookupResponse(
      stripeProvider(null).provider.createPrice(priceInput(), operationContext),
    );
    await expectInvalidLookupResponse(
      stripeProvider('yearly').provider.createPrice(priceInput(), operationContext),
    );
  });

  it('rejects missing, malformed, and mismatched lookup keys after transfer without leaking the value', async () => {
    for (const lookupKey of [null, 12, 'yearly']) {
      const error = await stripeProvider(lookupKey)
        .provider.transferPriceLookupKey(
          { providerPriceId: 'price_1', lookupKey: 'monthly' },
          operationContext,
        )
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: 'PROVIDER_RESPONSE_INVALID',
        context: { provider: 'stripe', field: 'lookup_key', providerPriceId: 'price_1' },
      });
      expect(JSON.stringify(error)).not.toContain('monthly');
    }
  });
});
