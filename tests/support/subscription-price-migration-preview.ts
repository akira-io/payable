import { createPayable } from '../../src/create-payable';
import type { IdempotencyStore } from '../../src/domain/contracts/idempotency-store.contract';
import type { StorageDriver } from '../../src/domain/contracts/storage-driver.contract';
import type {
  SubscriptionChangeApplicationOutcome,
  SubscriptionChangeOutcomeCapable,
} from '../../src/domain/contracts/subscription-change-provider.contract';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { SubscriptionDTO } from '../../src/domain/dtos/subscription.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../../src/domain/dtos/subscription-change.dto';
import type { SubscriptionOperationCapabilities } from '../../src/domain/dtos/subscription-operation-capabilities.dto';
import { Money } from '../../src/domain/value-objects/money';
import { KnexStorageDriver } from '../../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../../src/support/clock/fake-clock';
import { FakeProvider } from './fake-provider';
import { createTestDb } from './knex';

export const MIGRATION_TENANT = 'tenant_migrations';
export const MIGRATION_NOW = new Date('2026-08-25T10:00:00.000Z');
export const migrationPreviewInput = {
  timing: { effectiveTiming: 'immediate' as const },
  prorationPolicy: 'prorateImmediately' as const,
  paymentFailurePolicy: 'preventChange' as const,
  idempotencyKey: 'preview-one',
};

export type MigrationPreviewDatabase = ReturnType<typeof createTestDb>;

export class MigrationPreviewProvider extends FakeProvider {
  previewCalls = 0;
  applyCalls = 0;
  lastPreview?: ProviderSubscriptionChangeInput;
  lastPreviewContext?: OperationContext;
  lastApply?: ProviderSubscriptionChangeInput;
  lastApplyContext?: OperationContext;
  applyError?: Error;
  beforeApply?: () => Promise<void>;
  nextRenewalDate = new Date('2026-09-25T00:00:00Z');
  warnings: string[] = [];
  providerLimitations: string[] = [];
  supportsCurrencyChange = false;
  supportsBillingPeriodChange = false;

  override subscriptionOperationCapabilities(): SubscriptionOperationCapabilities {
    const capabilities = super.subscriptionOperationCapabilities();
    const change = {
      preview: true,
      effectiveTimings: ['immediate', 'nextRenewal', 'scheduled'] as const,
      prorationPolicies: ['prorateImmediately'] as const,
      paymentFailurePolicies: ['preventChange'] as const,
      supportsCurrencyChange: this.supportsCurrencyChange,
      supportsBillingPeriodChange: this.supportsBillingPeriodChange,
    };
    return {
      ...capabilities,
      changePrice: change,
      changeQuantity: change,
    };
  }

  async previewSubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    this.previewCalls += 1;
    this.lastPreview = input;
    this.lastPreviewContext = context;
    return {
      immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
      nextRenewal: { amount: 2_000, currency: 'USD', date: this.nextRenewalDate },
      warnings: this.warnings,
      providerLimitations: this.providerLimitations,
    };
  }

  async applySubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionDTO> {
    this.applyCalls += 1;
    this.lastApply = input;
    this.lastApplyContext = context;
    await this.beforeApply?.();
    if (this.applyError) throw this.applyError;
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: input.renewalDate,
      trialEndsAt: null,
    };
  }
}

export class MigrationOutcomePreviewProvider
  extends MigrationPreviewProvider
  implements SubscriptionChangeOutcomeCapable
{
  outcomeCalls = 0;
  outcomeError?: Error;
  outcome?: SubscriptionChangeApplicationOutcome;

  async applySubscriptionChangeWithOutcome(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionChangeApplicationOutcome> {
    this.outcomeCalls += 1;
    this.lastApply = input;
    this.lastApplyContext = context;
    await this.beforeApply?.();
    if (this.outcomeError) throw this.outcomeError;
    return (
      this.outcome ?? {
        kind: 'applied' as const,
        subscription: {
          providerSubscriptionId: input.providerSubscriptionId,
          status: 'active' as const,
          currentPeriodEnd: input.renewalDate,
          trialEndsAt: null,
        },
      }
    );
  }
}

export async function setupMigrationPreview(
  databases: MigrationPreviewDatabase[],
  providerKey = 'stripe',
  provider: MigrationPreviewProvider = new MigrationPreviewProvider(),
) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(MIGRATION_NOW);
  const storage = new KnexStorageDriver(database, clock);
  const fixture = await seedMigrationPreview(
    storage,
    new KnexIdempotencyRepository(database, clock),
    clock,
    providerKey,
    provider,
  );
  return { database, ...fixture };
}

export async function seedMigrationPreview<TStorage extends StorageDriver>(
  storage: TStorage,
  idempotency: IdempotencyStore,
  clock: FakeClock,
  providerKey = 'stripe',
  provider: MigrationPreviewProvider = new MigrationPreviewProvider(),
) {
  const payable = createPayable({
    providers: { [providerKey]: provider },
    storage,
    clock,
    tenant: { enabled: true },
    idempotency: { store: idempotency },
  });
  const customer = await payable.customers(undefined, MIGRATION_TENANT).create({
    billableType: 'User',
    billableId: 'migration-user',
    email: 'migration@example.com',
  });
  const product = await payable.products(MIGRATION_TENANT).create({ name: 'Canonical plan' });
  const source = await payable.prices(MIGRATION_TENANT).create({
    productId: product.id,
    unitAmount: Money.of(1_000, 'USD'),
    type: 'recurring',
    interval: 'month',
  });
  const target = await payable.prices(MIGRATION_TENANT).create({
    productId: product.id,
    unitAmount: Money.of(2_000, 'USD'),
    type: 'recurring',
    interval: 'month',
  });
  const subscription = await payable.canonicalSubscriptions(MIGRATION_TENANT).create({
    customerId: customer.id,
    name: 'default',
    priceId: source.id,
    activation: { state: 'active', startsAt: MIGRATION_NOW },
    collectionResponsibility: 'merchant',
    source: 'test',
  });
  const providerBinding = await payable
    .canonicalSubscriptions(MIGRATION_TENANT)
    .attachProvider(subscription.id, {
      provider: providerKey,
      providerSubscriptionId: 'sub_remote',
    });
  if (!storage.priceProviderBindings) throw new Error('Expected canonical price bindings');
  await storage.priceProviderBindings.create({
    tenantId: MIGRATION_TENANT,
    priceId: source.id,
    provider: providerKey,
    providerPriceId: 'price_source_remote',
  });
  await storage.priceProviderBindings.create({
    tenantId: MIGRATION_TENANT,
    priceId: target.id,
    provider: providerKey,
    providerPriceId: 'price_target_remote',
  });
  const [item] = await storage.subscriptionItems.listBySubscription(
    subscription.id,
    MIGRATION_TENANT,
  );
  if (!item) throw new Error('Expected canonical subscription item');
  await storage.subscriptionItems.updateById(
    subscription.id,
    item.id,
    { providerItemId: 'si_remote' },
    MIGRATION_TENANT,
  );
  return {
    payable,
    provider,
    storage,
    clock,
    product,
    source,
    target,
    subscription,
    providerBinding,
  };
}
