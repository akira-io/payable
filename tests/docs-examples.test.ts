import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

function stripeChargeExampleFromDocs() {
  const stripe = new StripeProvider({
    secretKey: 'sk_test_example',
    webhookSecret: 'whsec_example',
  });
  const payable = createPayable({ providers: { stripe } });
  return () =>
    payable
      .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' })
      .charge({ amount: Money.of(1500, 'USD'), reference: 'order-1' });
}

async function multiProviderCheckoutExampleFromDocs() {
  const stripe = new FakeProvider();
  const paddle = new FakeProvider();
  const payable = createPayable({ providers: { stripe, paddle } });

  const session = await payable
    .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' }, 'paddle')
    .newSubscription('default')
    .price('pri_paddle_pro')
    .checkout({
      successUrl: 'https://app.example.com/billing/success',
      cancelUrl: 'https://app.example.com/billing',
    });

  return { paddle, session, stripe };
}

async function catalogLifecycleExampleFromDocs() {
  const provider = new FakeProvider();
  provider.productsPage.nextCursor = 'prod_next';
  const payable = createPayable({ providers: { stripe: provider } });
  const firstPage = await payable.products().list({ limit: 50 });
  const firstProductListInput = provider.lastListProducts;
  if (firstPage.nextCursor) {
    await payable.products().list({ limit: 50, cursor: firstPage.nextCursor });
  }
  const nextProductListInput = provider.lastListProducts;
  const product = await payable.products().retrieve('prod_fake');
  const archivedProduct = await payable.products().archive('prod_fake');
  const activeProduct = await payable.products().activate('prod_fake');
  const archivedPrices = await payable.prices().list({
    limit: 100,
    cursor: 'price_cursor',
    providerProductId: 'prod_fake',
    active: false,
  });
  const priceListInput = provider.lastListPrices;
  const price = await payable.prices().retrieve('price_fake');
  const archivedPrice = await payable.prices().archive('price_fake');
  const activePrice = await payable.prices().activate('price_fake');
  const replacementPrice = await payable.prices().create({
    providerProductId: 'prod_fake',
    unitAmount: Money.of(12900, 'USD'),
    interval: 'month',
    intervalCount: 1,
  });
  return {
    activePrice,
    activeProduct,
    archivedPrice,
    archivedPrices,
    archivedProduct,
    firstPage,
    firstProductListInput,
    nextProductListInput,
    price,
    priceListInput,
    product,
    provider,
    replacementPrice,
  };
}

describe('documentation examples stay executable', () => {
  it('documents catalog tenant isolation and migration verification', () => {
    const contracts = readFileSync('docs/domain/33-contracts.md', 'utf8');
    const tenancy = readFileSync('docs/features/16-multi-tenancy.md', 'utf8');
    const knexStorage = readFileSync('docs/persistence/21-storage-knex.md', 'utf8');
    const prismaStorage = readFileSync('docs/persistence/21b-storage-prisma.md', 'utf8');

    expect(contracts).toContain('findById(id: string, tenantId: string | null)');
    expect(contracts).toContain('listByProduct(productId: string, tenantId: string | null)');
    expect(contracts).toContain(
      'findByProviderId(provider: string, providerProductId: string, tenantId: string | null)',
    );
    expect(contracts).toContain(
      'findByProviderId(provider: string, providerPriceId: string, tenantId: string | null)',
    );
    expect(tenancy).toContain('Product identity is `(tenant, provider, providerProductId)`');
    expect(knexStorage).toContain('009-catalog-tenant-keys');
    expect(knexStorage).toContain('payable_products_tenant_provider_product_unique');
    expect(knexStorage).toContain('payable_prices_tenant_provider_price_unique');
    expect(prismaStorage).toContain("WHERE tenant_key <> COALESCE(tenant_id, '');");
    expect(prismaStorage).toContain('WHERE id IN (:productIds);');
    expect(prismaStorage).toContain('WHERE id IN (:priceIds);');
    expect(prismaStorage).toContain(
      'must defer both tenant-key unique constraints until the contract stage',
    );
  });

  it('typechecks the Stripe charge example from docs/integrations/18-stripe.md', () => {
    expect(stripeChargeExampleFromDocs()).toBeTypeOf('function');
  });

  it('executes the named-provider checkout from docs/examples/36-multi-provider.md', async () => {
    const { paddle, session, stripe } = await multiProviderCheckoutExampleFromDocs();

    expect(session.url).toBe('https://fake.test/cs');
    expect(paddle.lastCheckout?.input.lineItems).toEqual([
      { priceId: 'pri_paddle_pro', quantity: 1 },
    ]);
    expect(stripe.lastCheckout).toBeUndefined();
  });

  it('executes and documents the catalog lifecycle example', async () => {
    const lifecycle = await catalogLifecycleExampleFromDocs();
    const example = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');

    expect(lifecycle.firstPage.data).toHaveLength(1);
    expect(lifecycle.firstPage.nextCursor).toBe('prod_next');
    expect(lifecycle.firstProductListInput).toEqual({ limit: 50, active: true });
    expect(lifecycle.nextProductListInput).toEqual({
      limit: 50,
      cursor: 'prod_next',
      active: true,
    });
    expect(lifecycle.product.providerProductId).toBe('prod_fake');
    expect(lifecycle.archivedProduct.active).toBe(false);
    expect(lifecycle.activeProduct.active).toBe(true);
    expect(lifecycle.provider.productActiveCalls).toMatchObject([
      { id: 'prod_fake', active: false },
      { id: 'prod_fake', active: true },
    ]);
    expect(lifecycle.archivedPrices.data).toHaveLength(1);
    expect(lifecycle.priceListInput).toEqual({
      limit: 100,
      cursor: 'price_cursor',
      providerProductId: 'prod_fake',
      active: false,
    });
    expect(lifecycle.price.providerPriceId).toBe('price_fake');
    expect(lifecycle.archivedPrice.active).toBe(false);
    expect(lifecycle.activePrice.active).toBe(true);
    expect(lifecycle.provider.priceActiveCalls).toMatchObject([
      { id: 'price_fake', active: false },
      { id: 'price_fake', active: true },
    ]);
    expect(lifecycle.replacementPrice.unitAmount.amount()).toBe(12900);
    expect(lifecycle.provider.lastCreatePrice?.providerProductId).toBe('prod_fake');
    expect(example).toContain("import { Money } from '@akira-io/payable';");
    expect(example).toContain('PRODUCT_NOT_FOUND');
    expect(example).toContain('Create a new price');
    expect(example).toContain('https://docs.stripe.com/api/products/list');
    expect(example).toContain('https://developer.paddle.com/api-reference/products/list-products/');
  });

  it('documents catalog capability declarations consistently', () => {
    const providers = readFileSync('docs/integrations/17-providers.md', 'utf8');
    const stripe = readFileSync('docs/integrations/18-stripe.md', 'utf8');
    const paddle = readFileSync('docs/integrations/19-paddle.md', 'utf8');

    expect(providers).toContain('| `CatalogReadCapable` |');
    expect(providers).toContain('| `CatalogLifecycleCapable` |');
    expect(providers).toContain('| `catalogRead` | yes | yes | no | no |');
    expect(providers).toContain('| `catalogLifecycle` | yes | yes | no | no |');
    expect(providers).toContain("| 'catalogRead'");
    expect(providers).toContain("| 'catalogLifecycle'");
    expect(stripe).toContain("'catalogRead'");
    expect(stripe).toContain("'catalogLifecycle'");
    expect(paddle).toContain("'catalogRead'");
    expect(paddle).toContain("'catalogLifecycle'");
  });

  it('executes the logical customer and provider binding example from docs/features/08-customers-billable.md', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: {
        stripe: new FakeProvider('cus_stripe'),
        paddle: new FakeProvider('ctm_paddle'),
      },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    const billable = {
      billableType: 'User',
      billableId: '1',
      email: 'jane@example.com',
      name: 'Jane',
    };

    const customer = await payable.customers('stripe').create(billable);
    await payable.customers('paddle').create(billable);
    const stripeBinding = await payable.customers('stripe').binding(billable);
    const paddleBinding = await payable.customers('paddle').binding(billable);

    expect(customer.email).toBe('jane@example.com');
    expect(stripeBinding?.providerCustomerId).toBe('cus_stripe');
    expect(paddleBinding?.providerCustomerId).toBe('ctm_paddle');
    await db.destroy();
  });
});
