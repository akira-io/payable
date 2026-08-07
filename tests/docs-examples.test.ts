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
  const firstPage = await payable.providerCatalog().products.list({ limit: 50 });
  const firstProductListInput = provider.lastListProducts;
  if (firstPage.nextCursor) {
    await payable.providerCatalog().products.list({ limit: 50, cursor: firstPage.nextCursor });
  }
  const nextProductListInput = provider.lastListProducts;
  const product = await payable.providerCatalog().products.retrieve('prod_fake');
  const archivedProduct = await payable.providerCatalog().products.archive('prod_fake');
  const activeProduct = await payable.providerCatalog().products.activate('prod_fake');
  const archivedPrices = await payable.providerCatalog().prices.list({
    limit: 100,
    cursor: 'price_cursor',
    providerProductId: 'prod_fake',
    active: false,
  });
  const priceListInput = provider.lastListPrices;
  const price = await payable.providerCatalog().prices.retrieve('price_fake');
  const archivedPrice = await payable.providerCatalog().prices.archive('price_fake');
  const activePrice = await payable.providerCatalog().prices.activate('price_fake');
  const replacementPrice = await payable.providerCatalog().prices.create({
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
    expect(tenancy).toContain('Canonical product and price identity is `(tenant, localId)`');
    expect(knexStorage).toContain('009-catalog-tenant-keys');
    expect(knexStorage).toContain('011-canonical-local-catalog');
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
    expect(example).toContain("authorization: { allowed: true, actorId: 'catalog-admin' }");
    expect(example).toContain('PRODUCT_NOT_FOUND');
    expect(example).toContain('Create a new price');
    expect(example).toContain('AUTHORIZATION_DENIED');
    expect(example).toContain('https://docs.stripe.com/api/products/list');
    expect(example).toContain('https://developer.paddle.com/api-reference/products/list-products/');
  });

  it('documents the catalog authorization boundary for direct and adapter calls', () => {
    const security = readFileSync('docs/28-security.md', 'utf8');

    expect(security).toContain('Payable does not authenticate callers');
    expect(security).toContain('CatalogMutationOptions');
    expect(security).toContain('AUTHORIZATION_DENIED');
    expect(security).toContain('before capability validation or provider calls');
    expect(security).not.toContain('Only `CanReplayWebhookPolicy` is wired into an action');
    for (const activePolicy of [
      'CanChargePolicy',
      'CanCreateCheckoutPolicy',
      'CanCreateSubscriptionPolicy',
      'CanCancelSubscriptionPolicy',
      'CanResumeSubscriptionPolicy',
      'CanUpdateSubscriptionPolicy',
      'CanRefundPaymentPolicy',
      'CanReplayWebhookPolicy',
    ]) {
      expect(security).toContain(activePolicy);
    }
    expect(security).toContain('`assertCatalogMutationAuthorized`');
    expect(security).toMatch(
      /global authorization is enabled or an\s+explicit catalog authorization\s+context is supplied/,
    );

    const mcp = readFileSync('docs/adapters/26-mcp.md', 'utf8');
    expect(mcp).toMatch(/even\s+when global authorization is disabled/);

    const adapterDocumentation: Array<[path: string, resolver: string]> = [
      ['docs/adapters/23-express.md', 'resolveAuthorization'],
      ['docs/adapters/24-fastify.md', 'resolveAuthorization'],
      ['docs/adapters/25-nestjs.md', 'resolveAuthorization'],
      ['docs/adapters/26-mcp.md', 'policy.authorization'],
    ];

    for (const [path, resolver] of adapterDocumentation) {
      const adapter = readFileSync(path, 'utf8');

      expect(adapter).toContain(resolver);
      expect(adapter).toContain('runs once');
      expect(adapter).toMatch(/core\s+resource makes\s+(?:the\s+)?final authorization decision/);
    }
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

  it('links the advanced subscription operations example from the index and adjacent guides', () => {
    const index = readFileSync('docs/00-index.md', 'utf8');
    const subscriptions = readFileSync('docs/examples/37-subscriptions.md', 'utf8');
    const customAudit = readFileSync('docs/examples/46-custom-domain-audit.md', 'utf8');
    const advancedOperations = readFileSync('docs/examples/47-subscription-operations.md', 'utf8');

    expect(index).toContain('examples/47-subscription-operations.md');
    expect(subscriptions).toContain('(47-subscription-operations.md)');
    expect(customAudit).toContain(
      '[Next: Advanced Subscription Operations](47-subscription-operations.md)',
    );
    expect(advancedOperations).toContain(
      '[Previous: Custom Domain Audit](46-custom-domain-audit.md)',
    );
  });
});
