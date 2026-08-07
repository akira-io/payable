import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../src/domain/dtos/subscription-change.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { SubscriptionLifecycleProvider } from './support/subscription-lifecycle-provider';

const billable = {
  billableType: 'Team',
  billableId: 'team_documentation',
  email: 'billing@example.com',
};
const databases: ReturnType<typeof createTestDb>[] = [];

class DocumentationSubscriptionProvider extends SubscriptionLifecycleProvider {
  failApply = false;

  override subscriptionOperationCapabilities() {
    const capabilities = super.subscriptionOperationCapabilities();
    return {
      ...capabilities,
      changePrice: {
        preview: true,
        effectiveTimings: ['immediate', 'nextRenewal'] as const,
        prorationPolicies: ['prorateImmediately', 'none'] as const,
        paymentFailurePolicies: ['preventChange', 'applyChange'] as const,
      },
    };
  }

  async previewSubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    return {
      immediateAdjustment: {
        direction: input.effectiveTiming === 'immediate' ? 'charge' : 'none',
        amount: input.effectiveTiming === 'immediate' ? 500 : 0,
        currency: 'USD',
      },
      nextRenewal: {
        amount: 2_000,
        date: new Date('2026-09-07T10:00:00.000Z'),
        currency: 'USD',
      },
      warnings: [],
      providerLimitations: [],
    };
  }

  async applySubscriptionChange(input: ProviderSubscriptionChangeInput, context: OperationContext) {
    if (this.failApply) {
      throw new Error('provider rejected payment');
    }
    return this.updateSubscription(
      {
        providerSubscriptionId: input.providerSubscriptionId,
        priceId: input.proposedItems[0]?.priceId,
        providerItemId: input.proposedItems[0]?.providerItemId,
        quantity: input.proposedItems[0]?.quantity,
      },
      context,
    );
  }
}

async function setupDocumentationSubscription() {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(new Date('2026-08-07T10:00:00.000Z'));
  const provider = new DocumentationSubscriptionProvider();
  const storage = new KnexStorageDriver(database, clock);
  const payable = createPayable({
    providers: { stripe: provider },
    storage,
    clock,
    idempotency: { store: new KnexIdempotencyRepository(database, clock) },
    tenant: { enabled: true },
  });
  const created = await payable
    .customer(billable, 'stripe', 'tenant_documentation')
    .newSubscription('default')
    .price('price_starter')
    .create();
  return {
    payable,
    provider,
    subscription: payable.subscription(created.id, 'tenant_documentation'),
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('advanced subscription operation documentation', () => {
  it('executes immediate and next-renewal price migration recipes', async () => {
    const { payable, subscription } = await setupDocumentationSubscription();
    const operations = payable.providers().subscriptionOperationCapabilities('stripe');
    expect(operations.changePrice.preview).toBe(true);

    const upgrade = await subscription.previewChange({
      priceId: 'price_business',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-upgrade-team-documentation',
    });
    await subscription.applyChange({
      previewToken: upgrade.previewToken,
      idempotencyKey: 'apply-upgrade-team-documentation',
    });
    expect((await subscription.retrieve()).priceId).toBe('price_business');

    const downgrade = await subscription.previewChange({
      priceId: 'price_starter',
      effectiveTiming: 'nextRenewal',
      prorationPolicy: 'none',
      paymentFailurePolicy: 'applyChange',
      idempotencyKey: 'preview-downgrade-team-documentation',
    });
    await subscription.applyChange({
      previewToken: downgrade.previewToken,
      idempotencyKey: 'apply-downgrade-team-documentation',
    });
    expect((await subscription.retrieve()).priceId).toBe('price_business');
  });

  it('keeps local state after a failed apply and executes pause and resume', async () => {
    const { provider, subscription } = await setupDocumentationSubscription();
    const preview = await subscription.previewChange({
      priceId: 'price_business',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-failed-team-documentation',
    });
    provider.failApply = true;
    await expect(
      subscription.applyChange({
        previewToken: preview.previewToken,
        idempotencyKey: 'apply-failed-team-documentation',
      }),
    ).rejects.toThrow('provider rejected payment');
    expect((await subscription.retrieve()).priceId).toBe('price_starter');

    provider.failApply = false;
    await subscription.pauseSubscription({
      effectiveTiming: 'immediate',
      resumeAt: null,
      resumeBillingPolicy: 'startNewBillingPeriod',
    });
    await subscription.resumePausedSubscription({
      effectiveTiming: 'immediate',
      billingPolicy: 'continueExistingBillingPeriod',
    });
    expect((await subscription.retrieve()).status).toBe('active');
  });

  it('documents every recipe and the unsupported-operation guard', () => {
    const documentation = readFileSync('docs/examples/47-subscription-operations.md', 'utf8');

    for (const heading of [
      'Immediate upgrade',
      'Downgrade at the next renewal',
      'Failed payment behavior',
      'Pause and resume',
      'Unsupported operations',
    ]) {
      expect(documentation).toContain(heading);
    }
    expect(documentation).toContain('subscriptionOperationCapabilities');
    expect(documentation).toContain('ProviderCapabilityNotSupportedError');
  });
});
