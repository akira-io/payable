import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PaddleCatalog } from '../src/infrastructure/providers/paddle/paddle-catalog';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';
import { StripeCatalog } from '../src/infrastructure/providers/stripe/stripe-catalog';

const context = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('catalog synchronization provider adapters', () => {
  it('updates a Stripe price with provider idempotency', async () => {
    const update = vi.fn().mockResolvedValue({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 1000,
      currency: 'usd',
      recurring: null,
      nickname: 'Updated',
      active: true,
    });
    const catalog = new StripeCatalog(async () => ({ prices: { update } }) as unknown as Stripe);

    await catalog.updatePrice({ providerPriceId: 'price_1', description: 'Updated' }, context);

    expect(update).toHaveBeenCalledWith(
      'price_1',
      { nickname: 'Updated' },
      { idempotencyKey: 'idem-1' },
    );
  });

  it('updates a Paddle price description', async () => {
    const update = vi.fn().mockResolvedValue({
      id: 'pri_1',
      productId: 'pro_1',
      unitPrice: { amount: '1000', currencyCode: 'USD' },
      description: 'Updated',
      status: 'active',
    });
    const catalog = new PaddleCatalog(
      async () => ({ prices: { update } }) as unknown as PaddleClient,
    );

    await catalog.updatePrice({ providerPriceId: 'pri_1', description: 'Updated' }, context);

    expect(update).toHaveBeenCalledWith('pri_1', { description: 'Updated' });
  });
});
