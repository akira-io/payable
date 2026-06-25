import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { FakeProvider } from './support/fake-provider';

describe('payable.products / payable.prices', () => {
  it('creates and updates a product at the provider', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const created = await payable.products().create({ name: 'Pro', description: 'Pro plan' });
    expect(created.providerProductId).toBe('prod_fake');
    expect(provider.lastCreateProduct?.name).toBe('Pro');

    const updated = await payable
      .products()
      .update({ providerProductId: 'prod_fake', name: 'Pro v2' });
    expect(updated.name).toBe('Pro v2');
    expect(provider.lastUpdateProduct?.providerProductId).toBe('prod_fake');
  });

  it('creates a price at the provider', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const price = await payable.prices().create({
      providerProductId: 'prod_fake',
      unitAmount: Money.of(9900, 'USD'),
      interval: 'month',
    });
    expect(price.providerPriceId).toBe('price_fake');
    expect(provider.lastCreatePrice?.unitAmount.amount()).toBe(9900);
    expect(provider.lastCreatePrice?.interval).toBe('month');
  });
});
