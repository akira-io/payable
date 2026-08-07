import { describe, expect, it } from 'vitest';
import { SubscriptionChangePreviewStore } from '../src/application/services/subscriptions/subscription-change-preview-store';
import type { SubscriptionChangePreview } from '../src/domain/dtos/subscription-change.dto';
import { FakeClock } from '../src/support/clock/fake-clock';
import { InMemoryIdempotencyStore } from './support/fakes';

const NOW = new Date('2026-08-07T10:00:00.000Z');

function preview(token = 'scp_opaque'): SubscriptionChangePreview {
  return {
    previewToken: token,
    provider: 'stripe',
    subscriptionId: 'subscription_local',
    currentItems: [
      { itemId: 'item_local', providerItemId: 'si_provider', priceId: 'price_old', quantity: 1 },
    ],
    proposedItems: [
      { itemId: 'item_local', providerItemId: 'si_provider', priceId: 'price_new', quantity: 2 },
    ],
    effectiveTiming: 'immediate',
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    calculatedAt: NOW,
    expiresAt: new Date('2026-08-07T10:15:00.000Z'),
    currentRenewalDate: new Date('2026-09-07T10:00:00.000Z'),
    immediateAdjustment: { direction: 'charge', amount: 500, currency: 'USD' },
    nextRenewal: { amount: 2_000, date: new Date('2026-09-07T10:00:00.000Z'), currency: 'USD' },
    warnings: [],
    providerLimitations: [],
  };
}

describe('SubscriptionChangePreviewStore', () => {
  it('isolates preview records by namespace and tenant', async () => {
    const records = new InMemoryIdempotencyStore();
    const store = new SubscriptionChangePreviewStore(records, new FakeClock(NOW));
    const saved = preview();

    await store.save(saved, 'tenant_a');

    expect(await store.load(saved.previewToken, 'tenant_a')).toEqual(saved);
    await expect(store.load(saved.previewToken, 'tenant_b')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND',
    });
    expect(await records.find(saved.previewToken, 'tenant_a')).toBeNull();
  });

  it('rejects an expired preview', async () => {
    const clock = new FakeClock(NOW);
    const store = new SubscriptionChangePreviewStore(new InMemoryIdempotencyStore(), clock);
    const saved = preview();
    await store.save(saved, 'tenant_a');
    clock.advance(15 * 60 * 1_000);

    await expect(store.load(saved.previewToken, 'tenant_a')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED',
    });
  });

  it('detects a changed stored preview contract', async () => {
    const records = new InMemoryIdempotencyStore();
    const store = new SubscriptionChangePreviewStore(records, new FakeClock(NOW));
    const saved = preview();
    await store.save(saved, 'tenant_a');
    const key = `subscription-change-preview:${saved.previewToken}`;
    const record = await records.find(key, 'tenant_a');
    await records.put(
      {
        ...(record as NonNullable<typeof record>),
        response: { ...saved, proposedItems: [{ ...saved.proposedItems[0], quantity: 9 }] },
      },
      'tenant_a',
    );

    await expect(store.load(saved.previewToken, 'tenant_a')).rejects.toMatchObject({
      code: 'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
    });
  });
});
