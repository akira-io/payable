import { afterEach, describe, expect, it } from 'vitest';
import { createSubscriptionChangeFixture } from './support/subscription-change';

describe('scheduled subscription change timing', () => {
  const fixture = createSubscriptionChangeFixture();
  const { setup } = fixture;

  afterEach(() => fixture.cleanup());

  it('rejects scheduled changes without an effective date before provider selection', async () => {
    const { provider, subscription } = await setup();

    await expect(
      subscription.previewChange({
        priceId: 'price_new',
        effectiveTiming: 'scheduled',
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
        idempotencyKey: 'preview-scheduled-without-date',
      } as never),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED' });
    expect(provider.lastPreview).toBeUndefined();
  });

  it('rejects non-scheduled changes with an effective date', async () => {
    const { provider, subscription } = await setup();

    await expect(
      subscription.previewChange({
        priceId: 'price_new',
        effectiveTiming: 'immediate',
        effectiveAt: new Date('2026-09-01T10:00:00.000Z'),
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
        idempotencyKey: 'preview-immediate-with-date',
      } as never),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED' });
    expect(provider.lastPreview).toBeUndefined();
  });

  it('propagates a scheduled effective date into provider inputs and audit records', async () => {
    const { payable, provider, subscription } = await setup();
    provider.supportsScheduledChanges = true;
    const effectiveAt = new Date('2026-09-01T10:00:00.000Z');

    const preview = await subscription.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'scheduled',
      effectiveAt,
      prorationPolicy: 'prorateImmediately',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'preview-scheduled',
    });
    await subscription.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-scheduled',
    });

    expect(preview.effectiveAt).toBe(effectiveAt);
    expect(provider.lastPreview?.effectiveAt).toBe(effectiveAt);
    expect(provider.lastApply?.effectiveAt).toStrictEqual(effectiveAt);
    const logs = await payable.auditLogs('tenant_a').run({ resourceId: preview.subscriptionId });
    for (const action of ['subscription.change_previewed', 'subscription.change_applied']) {
      expect(logs.find((entry) => entry.action === action)?.after).toMatchObject({
        effectiveTiming: 'scheduled',
        effectiveAt: effectiveAt.toISOString(),
      });
    }
  });

  it('rejects unsupported scheduled timing before calling the provider', async () => {
    const { provider, subscription } = await setup();

    await expect(
      subscription.previewChange({
        priceId: 'price_new',
        effectiveTiming: 'scheduled',
        effectiveAt: new Date('2026-09-01T10:00:00.000Z'),
        prorationPolicy: 'prorateImmediately',
        paymentFailurePolicy: 'preventChange',
        idempotencyKey: 'preview-unsupported-scheduled',
      } as never),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.change.scheduled' },
    });
    expect(provider.lastPreview).toBeUndefined();
  });
});
