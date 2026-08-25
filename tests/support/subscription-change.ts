import { createPayable } from '../../src/create-payable';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../../src/domain/dtos/subscription-change.dto';
import { KnexStorageDriver } from '../../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../../src/support/clock/fake-clock';
import { FakeProvider } from './fake-provider';
import { createTestDb } from './knex';

export const subscriptionChangeBillable = {
  billableType: 'User',
  billableId: 'preview-user',
  email: 'user@example.com',
};

export class SubscriptionChangeProvider extends FakeProvider {
  lastPreview?: ProviderSubscriptionChangeInput;
  lastApply?: ProviderSubscriptionChangeInput;
  applyCalls = 0;
  applyError?: Error;
  supportsScheduledChanges = false;

  override subscriptionOperationCapabilities() {
    const capabilities = super.subscriptionOperationCapabilities();
    return {
      ...capabilities,
      changePrice: this.changeCapabilities(),
      changeQuantity: this.changeCapabilities(),
    };
  }

  async previewSubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    this.lastPreview = input;
    return {
      immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
      nextRenewal: { amount: 2_000, date: new Date('2026-09-07T10:00:00.000Z'), currency: 'USD' },
      warnings: [],
      providerLimitations: [],
    };
  }

  async applySubscriptionChange(input: ProviderSubscriptionChangeInput, context: OperationContext) {
    this.applyCalls += 1;
    this.lastApply = input;
    if (this.applyError) {
      throw this.applyError;
    }
    return this.updateSubscription(
      {
        providerSubscriptionId: input.providerSubscriptionId,
        priceId: input.proposedItems[0]?.priceId,
        quantity: input.proposedItems[0]?.quantity,
        providerItemId: input.proposedItems[0]?.providerItemId,
      },
      context,
    );
  }

  private changeCapabilities() {
    return {
      preview: true,
      effectiveTimings: this.supportsScheduledChanges
        ? (['immediate', 'scheduled'] as const)
        : (['immediate'] as const),
      prorationPolicies: ['prorateImmediately'] as const,
      paymentFailurePolicies: ['preventChange'] as const,
      supportsCurrencyChange: false,
      supportsBillingPeriodChange: false,
    };
  }
}

export function createSubscriptionChangeFixture() {
  const databases: Array<ReturnType<typeof createTestDb>> = [];

  return {
    async setup(tenantId = 'tenant_a') {
      const database = createTestDb();
      databases.push(database);
      await migrate(database);
      const clock = new FakeClock(new Date('2026-08-07T10:00:00.000Z'));
      const provider = new SubscriptionChangeProvider();
      const storage = new KnexStorageDriver(database, clock);
      const payable = createPayable({
        providers: { stripe: provider },
        storage,
        clock,
        idempotency: { store: new KnexIdempotencyRepository(database, clock) },
        tenant: { enabled: true },
      });
      const customer = payable.customer(subscriptionChangeBillable, undefined, tenantId);
      await customer.newSubscription('default').price('price_old').create();
      return { payable, provider, clock, storage, subscription: customer.subscription('default') };
    },
    async cleanup() {
      await Promise.all(databases.splice(0).map((database) => database.destroy()));
    },
  };
}
