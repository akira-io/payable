import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const operationContext = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

function stripeProvider(stripeClient: Stripe): StripeProvider {
  return new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, stripeClient);
}

describe('Stripe catalog', () => {
  it('advertises catalog reads and lifecycle operations and creates price nicknames', async () => {
    const pricesCreate = vi.fn().mockResolvedValue({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 9900,
      currency: 'usd',
      recurring: null,
      nickname: 'Monthly plan',
      active: true,
    });
    const provider = stripeProvider({ prices: { create: pricesCreate } } as unknown as Stripe);

    await provider.createPrice(
      {
        providerProductId: 'prod_1',
        unitAmount: Money.of(9900, 'USD'),
        description: 'Monthly plan',
      },
      operationContext,
    );

    expect(provider.capabilities().has('catalogRead')).toBe(true);
    expect(provider.capabilities().has('catalogLifecycle')).toBe(true);
    expect(pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: 'Monthly plan' }),
      { idempotencyKey: 'idem-1' },
    );
  });

  it('retrieves and lists Stripe catalog resources with normalized fields and cursors', async () => {
    const productsRetrieve = vi.fn().mockResolvedValue({
      id: 'prod_1',
      name: 'Pro',
      description: 'Team plan',
      active: true,
      metadata: { tier: 'pro' },
    });
    const productsList = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'prod_2',
          name: 'Enterprise',
          description: 'Large teams',
          active: false,
          metadata: { tier: 'enterprise' },
        },
      ],
      has_more: true,
    });
    const pricesRetrieve = vi.fn().mockResolvedValue({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 9900,
      currency: 'usd',
      recurring: { interval: 'month', interval_count: 3 },
      nickname: 'Quarterly plan',
      active: true,
    });
    const pricesList = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'price_2',
          product: 'prod_1',
          unit_amount: 1500,
          currency: 'eur',
          recurring: null,
          nickname: null,
          active: false,
        },
      ],
      has_more: false,
    });
    const provider = stripeProvider({
      products: { retrieve: productsRetrieve, list: productsList },
      prices: { retrieve: pricesRetrieve, list: pricesList },
    } as unknown as Stripe);

    await expect(provider.retrieveProduct('prod_1')).resolves.toEqual({
      providerProductId: 'prod_1',
      name: 'Pro',
      description: 'Team plan',
      active: true,
      metadata: { tier: 'pro' },
    });
    await expect(
      provider.listProducts({ limit: 2, cursor: 'prod_prev', active: false }),
    ).resolves.toEqual({
      data: [
        {
          providerProductId: 'prod_2',
          name: 'Enterprise',
          description: 'Large teams',
          active: false,
          metadata: { tier: 'enterprise' },
        },
      ],
      nextCursor: 'prod_2',
    });
    const price = await provider.retrievePrice('price_1');
    expect(price).toMatchObject({
      providerPriceId: 'price_1',
      providerProductId: 'prod_1',
      interval: 'month',
      intervalCount: 3,
      description: 'Quarterly plan',
      active: true,
    });
    expect(price.unitAmount.amount()).toBe(9900);
    expect(price.unitAmount.currency()).toBe('USD');
    await expect(
      provider.listPrices({
        limit: 2,
        cursor: 'price_prev',
        active: true,
        providerProductId: 'prod_1',
      }),
    ).resolves.toMatchObject({
      data: [
        {
          providerPriceId: 'price_2',
          providerProductId: 'prod_1',
          interval: null,
          intervalCount: null,
          description: null,
          active: false,
        },
      ],
      nextCursor: null,
    });
    expect(productsList).toHaveBeenCalledWith({
      active: false,
      limit: 2,
      starting_after: 'prod_prev',
    });
    expect(pricesList).toHaveBeenCalledWith({
      active: true,
      limit: 2,
      product: 'prod_1',
      starting_after: 'price_prev',
    });
  });

  it('sets Stripe product and price activity with idempotency keys', async () => {
    const productsUpdate = vi.fn().mockResolvedValue({
      id: 'prod_1',
      name: 'Pro',
      description: null,
      active: false,
      metadata: {},
    });
    const pricesUpdate = vi.fn().mockResolvedValue({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 9900,
      currency: 'usd',
      recurring: null,
      nickname: null,
      active: false,
    });
    const provider = stripeProvider({
      products: { update: productsUpdate },
      prices: { update: pricesUpdate },
    } as unknown as Stripe);

    await provider.setProductActive('prod_1', false, operationContext);
    await provider.setPriceActive('price_1', false, operationContext);

    expect(productsUpdate).toHaveBeenCalledWith(
      'prod_1',
      { active: false },
      { idempotencyKey: 'idem-1' },
    );
    expect(pricesUpdate).toHaveBeenCalledWith(
      'price_1',
      { active: false },
      { idempotencyKey: 'idem-1' },
    );
  });

  it('maps missing Stripe catalog resources by operation while list failures remain request errors', async () => {
    const resourceMissing = () => {
      throw { type: 'StripeInvalidRequestError', code: 'resource_missing', message: 'missing' };
    };
    const provider = stripeProvider({
      products: { retrieve: resourceMissing, update: resourceMissing, list: resourceMissing },
      prices: { retrieve: resourceMissing, update: resourceMissing },
    } as unknown as Stripe);

    await expect(provider.retrieveProduct('prod_missing')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
    await expect(
      provider.setProductActive('prod_missing', false, operationContext),
    ).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
    await expect(provider.retrievePrice('price_missing')).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
    });
    await expect(
      provider.setPriceActive('price_missing', false, operationContext),
    ).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
    });
    await expect(provider.listProducts()).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
