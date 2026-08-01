import { expect, it } from 'vitest';
import { createPayable } from '../../../src/create-payable';
import { Money } from '../../../src/domain/value-objects/money';
import { FakeProvider } from '../fake-provider';
import type { ContractContext } from './harness';

export function registerCatalogCasCompatibilityContract(ctx: ContractContext): void {
  it('updates a raw lowercase price through a lifecycle mutation', async () => {
    const harness = ctx.harness();
    const product = await harness.storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_legacy_currency',
      name: 'Legacy price parent',
      description: null,
      active: true,
      metadata: null,
    });
    const price = await harness.storage.prices.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerPriceId: 'price_legacy_currency',
      productId: product.id,
      currency: 'USD',
      unitAmount: 2499,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
    await harness.setRawPriceCurrency(price.id, 'usd');
    const provider = new FakeProvider();
    provider.pricesPage = {
      data: [
        {
          providerPriceId: 'price_legacy_currency',
          providerProductId: 'prod_legacy_currency',
          unitAmount: Money.of(2499, 'USD'),
          interval: 'month',
          intervalCount: 1,
          description: null,
          active: true,
        },
      ],
      nextCursor: null,
    };
    const payable = createPayable({
      providers: { stripe: provider },
      storage: harness.storage,
      clock: harness.clock,
    });

    await payable.prices('stripe', 'tenant-a').archive('price_legacy_currency');

    await expect(harness.storage.prices.findById(price.id, 'tenant-a')).resolves.toMatchObject({
      currency: 'USD',
      active: false,
    });
    expect(await harness.storage.auditLogs.list({ resourceType: 'price' })).toMatchObject([
      { action: 'price.archived', resourceId: price.id },
    ]);
    expect(await harness.storage.outboxEvents.claimPending(10)).toMatchObject([
      { eventType: 'price.archived.v1' },
    ]);
  });
}
