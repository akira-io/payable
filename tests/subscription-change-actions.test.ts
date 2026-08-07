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
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: 'preview-user', email: 'user@example.com' };

class SubscriptionChangeProvider extends FakeProvider {
  lastPreview?: ProviderSubscriptionChangeInput;
  lastApply?: ProviderSubscriptionChangeInput;
  applyError?: Error;

  override subscriptionOperationCapabilities() {
    const capabilities = super.subscriptionOperationCapabilities();
    return {
      ...capabilities,
      changePrice: {
        preview: true,
        effectiveTimings: ['immediate'] as const,
        prorationPolicies: ['prorateImmediately'] as const,
        paymentFailurePolicies: ['preventChange'] as const,
      },
      changeQuantity: {
        preview: true,
        effectiveTimings: ['immediate'] as const,
        prorationPolicies: ['prorateImmediately'] as const,
        paymentFailurePolicies: ['preventChange'] as const,
      },
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
}

describe('subscription change preview and apply', () => {
  const databases: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  async function setup(tenantId = 'tenant_a') {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-07T10:00:00.000Z'));
    const provider = new SubscriptionChangeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, clock),
      clock,
      idempotency: { store: new KnexIdempotencyRepository(database, clock) },
      tenant: { enabled: true },
    });
    const customer = payable.customer(billable, undefined, tenantId);
    await customer.newSubscription('default').price('price_old').create();
    return { payable, provider, clock, subscription: customer.subscription('default') };
  }

  it('binds apply to the exact stored preview and audits both operations', async () => {
    const { payable, provider, subscription } = await setup();
    const preview = await subscription.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-1',
    });

    expect(preview.previewToken).toMatch(/^scp_/);
    expect(provider.lastPreview?.calculatedAt).toEqual(preview.calculatedAt);
    const updated = await subscription.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-1',
    });

    expect(updated.priceId).toBe('price_new');
    expect(provider.lastApply).toEqual(provider.lastPreview);
    const logs = await payable.auditLogs('tenant_a').run({ resourceId: updated.id });
    expect(logs.map((entry) => entry.action)).toEqual([
      'subscription.change_applied',
      'subscription.change_previewed',
      'subscription.created',
    ]);
  });

  it('does not mutate local state when the provider rejects apply', async () => {
    const { provider, subscription } = await setup();
    const preview = await subscription.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-failure',
    });
    provider.applyError = new Error('provider rejected');

    await expect(
      subscription.applyChange({
        previewToken: preview.previewToken,
        idempotencyKey: 'apply-failure',
      }),
    ).rejects.toThrow('provider rejected');
    expect((await subscription.get())?.priceId).toBe('price_old');
  });

  it('keeps preview tokens tenant scoped and expires them', async () => {
    const { payable, clock, subscription } = await setup();
    const preview = await subscription.previewChange({
      quantity: 2,
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-expiry',
    });

    const foreign = payable.customer(billable, undefined, 'tenant_b').subscription('default');
    await expect(
      foreign.applyChange({ previewToken: preview.previewToken, idempotencyKey: 'foreign' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND' });
    clock.advance(15 * 60 * 1_000);
    await expect(
      subscription.applyChange({ previewToken: preview.previewToken, idempotencyKey: 'expired' }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED' });
  });

  it('rejects legacy mutation calls that omit explicit policies', async () => {
    const { provider, subscription } = await setup();

    const legacySwap = subscription.swap as unknown as (priceId: string) => Promise<unknown>;
    const legacyQuantity = subscription.updateQuantity as unknown as (
      quantity: number,
    ) => Promise<unknown>;

    await expect(legacySwap.call(subscription, 'price_new')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
    });
    await expect(legacyQuantity.call(subscription, 2)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
    });
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
  });

  it('rejects previews that do not change price or quantity', async () => {
    const { provider, subscription } = await setup();

    await expect(
      subscription.previewChange({
        effectiveTiming: 'immediate',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
        idempotencyKey: 'preview-empty',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_EMPTY' });
    expect(provider.lastPreview).toBeUndefined();
  });
});
