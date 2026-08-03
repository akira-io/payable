import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import { StripeCatalog } from '../src/infrastructure/providers/stripe/stripe-catalog';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import {
  createStripeCatalogClient,
  createStripeCatalogPrice,
} from './support/stripe-catalog-client';

const operationContext = {
  correlationId: 'corr-lookup',
  idempotencyKey: `payable:catalog:v1:${'a'.repeat(64)}`,
};

function stripeProvider() {
  const catalog = createStripeCatalogClient();
  return {
    ...catalog,
    provider: new StripeProvider(
      { secretKey: 'sk_test', webhookSecret: 'wh_test' },
      catalog.client,
    ),
  };
}

function createInput(lookupKey?: string, transferLookupKey?: boolean) {
  return {
    providerProductId: 'prod_1',
    unitAmount: Money.of(9900, 'USD'),
    description: 'Monthly plan',
    lookupKey,
    transferLookupKey,
  };
}

describe('Stripe price lookup keys', () => {
  it('maps lookup-key requests and omits ordinary lookup fields', async () => {
    const { provider, pricesCreate, pricesList, pricesUpdate } = stripeProvider();
    pricesCreate.mockImplementation(async (params) =>
      createStripeCatalogPrice({
        lookup_key: (params as { lookup_key?: string }).lookup_key ?? null,
      }),
    );
    pricesUpdate.mockResolvedValue(createStripeCatalogPrice({ lookup_key: 'monthly' }));

    await provider.createPrice(createInput(), operationContext);
    await provider.createPrice(createInput('monthly'), operationContext);
    await provider.createPrice(createInput('monthly', true), operationContext);
    await provider.createPrice(createInput('yearly', false), operationContext);
    await provider.listPrices({
      active: true,
      limit: 2,
      providerProductId: 'prod_1',
      cursor: 'price_prev',
      lookupKeys: ['monthly', 'yearly'],
    });
    await provider.transferPriceLookupKey(
      { providerPriceId: 'price_1', lookupKey: 'monthly' },
      operationContext,
    );

    expect(pricesCreate).toHaveBeenNthCalledWith(
      1,
      {
        product: 'prod_1',
        currency: 'usd',
        unit_amount: 9900,
        nickname: 'Monthly plan',
      },
      { idempotencyKey: operationContext.idempotencyKey },
    );
    expect(pricesCreate).toHaveBeenNthCalledWith(
      2,
      {
        product: 'prod_1',
        currency: 'usd',
        unit_amount: 9900,
        nickname: 'Monthly plan',
        lookup_key: 'monthly',
      },
      { idempotencyKey: operationContext.idempotencyKey },
    );
    expect(pricesCreate).toHaveBeenNthCalledWith(
      3,
      {
        product: 'prod_1',
        currency: 'usd',
        unit_amount: 9900,
        nickname: 'Monthly plan',
        lookup_key: 'monthly',
        transfer_lookup_key: true,
      },
      { idempotencyKey: operationContext.idempotencyKey },
    );
    expect(pricesCreate).toHaveBeenNthCalledWith(
      4,
      {
        product: 'prod_1',
        currency: 'usd',
        unit_amount: 9900,
        nickname: 'Monthly plan',
        lookup_key: 'yearly',
      },
      { idempotencyKey: operationContext.idempotencyKey },
    );
    expect(pricesList).toHaveBeenCalledWith({
      active: true,
      limit: 2,
      product: 'prod_1',
      starting_after: 'price_prev',
      lookup_keys: ['monthly', 'yearly'],
    });
    expect(pricesUpdate).toHaveBeenCalledWith(
      'price_1',
      { lookup_key: 'monthly', transfer_lookup_key: true },
      { idempotencyKey: operationContext.idempotencyKey },
    );
  });

  it('advertises lookup keys only for Stripe', () => {
    const { provider } = stripeProvider();
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' });

    expect(provider.capabilities().has('priceLookupKeys')).toBe(true);
    expect(paddle.capabilities().has('priceLookupKeys')).toBe(false);
  });

  it('rejects invalid lookup-key inputs before acquiring Stripe and preserves empty filters', async () => {
    const catalog = createStripeCatalogClient();
    const client = vi.fn(async () => catalog.client);
    const adapter = new StripeCatalog(client);

    await expect(
      adapter.createPrice(createInput('😀'.repeat(201)), operationContext),
    ).rejects.toMatchObject({
      code: 'PRICE_LOOKUP_KEY_INVALID',
    });
    await expect(
      adapter.listPrices({ lookupKeys: Array.from({ length: 11 }, () => 'monthly') }),
    ).rejects.toMatchObject({
      code: 'PRICE_LOOKUP_KEY_INVALID',
    });
    await expect(
      adapter.transferPriceLookupKey(
        { providerPriceId: ' ', lookupKey: 'monthly' },
        operationContext,
      ),
    ).rejects.toMatchObject({ code: 'PRICE_LOOKUP_KEY_INVALID' });
    await expect(adapter.listPrices({ lookupKeys: [] })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    expect(client).not.toHaveBeenCalled();
  });

  it('maps missing transfer targets and request failures without inspecting Stripe messages', async () => {
    const { provider, pricesUpdate } = stripeProvider();
    const missing = {
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
      message: 'irrelevant',
    };
    pricesUpdate.mockRejectedValueOnce(missing);

    await expect(
      provider.transferPriceLookupKey(
        { providerPriceId: 'price_missing', lookupKey: 'monthly' },
        operationContext,
      ),
    ).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
      correlationId: operationContext.correlationId,
      context: {
        providerPriceId: 'price_missing',
        provider: 'stripe',
        stripeType: 'StripeInvalidRequestError',
        stripeCode: 'resource_missing',
      },
      cause: missing,
    });

    const collision = {
      type: 'StripeInvalidRequestError',
      code: 'parameter_invalid_empty',
      message: 'a collision-shaped message that must not affect mapping',
    };
    pricesUpdate.mockRejectedValueOnce(collision);
    await expect(
      provider.transferPriceLookupKey(
        { providerPriceId: 'price_1', lookupKey: 'monthly' },
        operationContext,
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: {
        provider: 'stripe',
        stripeType: 'StripeInvalidRequestError',
        stripeCode: 'parameter_invalid_empty',
      },
      cause: collision,
    });
  });
});
