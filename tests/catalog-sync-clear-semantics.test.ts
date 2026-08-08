import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PaddleCatalog } from '../src/infrastructure/providers/paddle/paddle-catalog';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';
import { StripeCatalog } from '../src/infrastructure/providers/stripe/stripe-catalog';

const context = { correlationId: 'corr-clear', tenantId: null, idempotencyKey: 'idem-clear' };

describe('catalog synchronization clear semantics', () => {
  it('maps explicit product and price clears to Stripe empty values', async () => {
    const updateProduct = vi.fn().mockResolvedValue({ id: 'prod_1', name: 'Pro', active: true });
    const updatePrice = vi.fn().mockResolvedValue({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 1000,
      currency: 'eur',
      active: true,
    });
    const catalog = new StripeCatalog(
      async () =>
        ({
          products: { update: updateProduct },
          prices: { update: updatePrice },
        }) as unknown as Promise<Stripe>,
    );

    await catalog.updateProduct(
      { providerProductId: 'prod_1', description: null, metadata: null },
      context,
    );
    await catalog.updatePrice({ providerPriceId: 'price_1', description: null }, context);

    expect(updateProduct).toHaveBeenCalledWith(
      'prod_1',
      expect.objectContaining({ description: '', metadata: '' }),
      { idempotencyKey: 'idem-clear' },
    );
    expect(updatePrice).toHaveBeenCalledWith(
      'price_1',
      { nickname: '' },
      { idempotencyKey: 'idem-clear' },
    );
  });

  it('rejects unsupported Paddle clears before a remote call', async () => {
    const updateProduct = vi.fn();
    const updatePrice = vi.fn();
    const catalog = new PaddleCatalog(
      async () =>
        ({
          products: { update: updateProduct },
          prices: { update: updatePrice },
        }) as unknown as Promise<PaddleClient>,
    );

    await expect(
      catalog.updateProduct({ providerProductId: 'pro_1', description: null }, context),
    ).rejects.toMatchObject({ code: 'CATALOG_UPDATE_CLEAR_UNSUPPORTED' });
    await expect(
      catalog.updatePrice({ providerPriceId: 'pri_1', description: null }, context),
    ).rejects.toMatchObject({ code: 'CATALOG_UPDATE_CLEAR_UNSUPPORTED' });
    expect(updateProduct).not.toHaveBeenCalled();
    expect(updatePrice).not.toHaveBeenCalled();
  });
});
