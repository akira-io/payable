import { afterEach, describe, expect, it } from 'vitest';
import type { SubscriptionChangePreview } from '../src/domain/dtos/subscription-change.dto';
import type { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import {
  createSubscriptionChangeFixture,
  subscriptionChangeBillable,
} from './support/subscription-change';

function previewItemId(preview: SubscriptionChangePreview): string {
  const item = preview.currentItems[0];
  if (!item) {
    throw new Error('Expected one current subscription item');
  }
  return item.itemId;
}

describe('subscription change preview and apply', () => {
  const fixture = createSubscriptionChangeFixture();
  const { setup } = fixture;

  afterEach(() => fixture.cleanup());

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

  it('replays an applied immediate preview without reapplying at the provider', async () => {
    const { provider, subscription } = await setup();
    const preview = await subscription.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-immediate-replay',
    });
    await subscription.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-immediate-replay-1',
    });

    const replayed = await subscription.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-immediate-replay-2',
    });

    expect(replayed.priceId).toBe('price_new');
    expect(provider.applyCalls).toBe(1);
  });

  it.each([
    [
      'price',
      async (storage: KnexStorageDriver, preview: SubscriptionChangePreview) =>
        storage.subscriptionItems.updateById(
          preview.subscriptionId,
          previewItemId(preview),
          { priceId: 'price_drifted' },
          'tenant_a',
        ),
    ],
    [
      'quantity',
      async (storage: KnexStorageDriver, preview: SubscriptionChangePreview) =>
        storage.subscriptionItems.updateById(
          preview.subscriptionId,
          previewItemId(preview),
          { quantity: 7 },
          'tenant_a',
        ),
    ],
    [
      'provider item identity',
      async (storage: KnexStorageDriver, preview: SubscriptionChangePreview) =>
        storage.subscriptionItems.updateById(
          preview.subscriptionId,
          previewItemId(preview),
          { providerItemId: 'provider_item_drifted' },
          'tenant_a',
        ),
    ],
    [
      'membership',
      async (storage: KnexStorageDriver, preview: SubscriptionChangePreview) =>
        storage.subscriptionItems.create({
          subscriptionId: preview.subscriptionId,
          priceId: 'price_extra',
          providerItemId: 'provider_item_extra',
          quantity: 1,
        }),
    ],
  ])('rejects a stale preview after local %s drift before provider apply', async (_kind, drift) => {
    const { provider, storage, subscription } = await setup();
    const preview = await subscription.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'immediate',
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: `preview-drift-${_kind}`,
    });
    await drift(storage, preview);

    await expect(
      subscription.applyChange({
        previewToken: preview.previewToken,
        idempotencyKey: `apply-drift-${_kind}`,
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_PREVIEW_STALE' });
    expect(provider.lastApply).toBeUndefined();
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

    const foreign = payable
      .customer(subscriptionChangeBillable, undefined, 'tenant_b')
      .subscription('default');
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
