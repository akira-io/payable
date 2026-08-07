import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { FakeProvider } from './support/fake-provider';

describe('payable.products / payable.prices', () => {
  it('creates and updates a product at the provider', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const created = await payable
      .providerCatalog()
      .products.create({ name: 'Pro', description: 'Pro plan' });
    expect(created.providerProductId).toBe('prod_fake');
    expect(provider.lastCreateProduct?.name).toBe('Pro');

    const updated = await payable
      .providerCatalog()
      .products.update({ providerProductId: 'prod_fake', name: 'Pro v2' });
    expect(updated.name).toBe('Pro v2');
    expect(provider.lastUpdateProduct?.providerProductId).toBe('prod_fake');
  });

  it('creates a price at the provider', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const price = await payable.providerCatalog().prices.create({
      providerProductId: 'prod_fake',
      unitAmount: Money.of(9900, 'USD'),
      interval: 'month',
    });
    expect(price.providerPriceId).toBe('price_fake');
    expect(provider.lastCreatePrice?.unitAmount.amount()).toBe(9900);
    expect(provider.lastCreatePrice?.interval).toBe('month');
  });

  it('rejects catalog operations when the provider lacks the capability', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('catalog');
    const payable = createPayable({ providers: { stripe: provider } });

    await expect(payable.providerCatalog().products.create({ name: 'Pro' })).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
    await expect(
      payable
        .providerCatalog()
        .prices.create({ providerProductId: 'prod_fake', unitAmount: Money.of(9900, 'USD') }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED' });
  });

  it('uses portable product list defaults', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await payable.providerCatalog().products.retrieve('prod_fake');
    await payable.providerCatalog().products.list();

    expect(provider.lastListProducts).toEqual({ limit: 50, active: true });
  });

  it('preserves price list filters', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await payable.providerCatalog().prices.list({
      limit: 25,
      cursor: 'pri_cursor',
      active: false,
      providerProductId: 'prod_fake',
    });

    expect(provider.lastListPrices).toEqual({
      limit: 25,
      cursor: 'pri_cursor',
      active: false,
      providerProductId: 'prod_fake',
    });
  });

  it('rejects invalid limits before provider calls', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await expect(payable.providerCatalog().products.list({ limit: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(payable.providerCatalog().prices.list({ limit: 101 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(provider.lastListProducts).toBeUndefined();
  });

  it('maps archive and activate to boolean calls', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await payable.providerCatalog().products.archive('prod_fake');
    await payable.providerCatalog().prices.activate('price_fake');

    expect(provider.productActiveCalls.at(-1)).toMatchObject({ id: 'prod_fake', active: false });
    expect(provider.priceActiveCalls.at(-1)).toMatchObject({ id: 'price_fake', active: true });
  });

  it('rejects lifecycle mutations before provider calls when authorization is denied', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      authorization: { enabled: true },
    });

    await expect(payable.providerCatalog().products.archive('prod_fake')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(
      payable.providerCatalog().prices.activate('price_fake', {
        authorization: { allowed: false, actorId: 'viewer' },
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    expect(provider.productActiveCalls).toEqual([]);
    expect(provider.priceActiveCalls).toEqual([]);
  });

  it('rejects reads when the provider lacks the catalog read capability', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('catalogRead');
    const payable = createPayable({ providers: { stripe: provider } });

    await expect(payable.providerCatalog().products.retrieve('prod_fake')).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
  });

  it('rejects lifecycle calls when the provider lacks the catalog lifecycle capability', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('catalogLifecycle');
    const payable = createPayable({ providers: { stripe: provider } });

    await expect(payable.providerCatalog().prices.archive('price_fake')).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
  });
});
