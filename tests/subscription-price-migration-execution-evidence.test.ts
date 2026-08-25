import { describe, expect, it } from 'vitest';
import type { SubscriptionChangeItem } from '../src/domain/dtos/subscription-change.dto';
import {
  decodeSubscriptionPriceMigrationExecutionEvidence,
  encodeSubscriptionPriceMigrationExecutionEvidence,
} from '../src/domain/internal/subscription-price-migration-execution-evidence';

const canonicalItems = [
  { id: 'A', priceId: 'canonical-a', quantity: 1 },
  { id: 'B', priceId: 'canonical-b', quantity: 2 },
] as const;

const providerItems = [
  { itemId: 'A', providerItemId: 'provider-a', priceId: 'remote-a', quantity: 1 },
  { itemId: 'B', providerItemId: 'provider-b', priceId: 'remote-b', quantity: 2 },
] as const;

describe('subscription price migration execution evidence alignment', () => {
  it.each([
    ['duplicate item id', [providerItems[0], providerItems[0]]],
    ['missing canonical item', [providerItems[0]]],
    [
      'extra provider item',
      [
        ...providerItems,
        { itemId: 'C', providerItemId: 'provider-c', priceId: 'remote-c', quantity: 3 },
      ],
    ],
    ['quantity mismatch', [{ ...providerItems[0], quantity: 2 }, providerItems[1]]],
  ] as const)('rejects %s', (_case, currentItems) => {
    expect(() => encodeEvidence(currentItems)).toThrow(/provider_evidence\.currentItems/);
  });

  it('accepts an exact item set in a different order', () => {
    const reordered = [providerItems[1], providerItems[0]];

    const encoded = encodeEvidence(reordered);

    expect(
      decodeSubscriptionPriceMigrationExecutionEvidence(encoded, canonicalItems, canonicalItems),
    ).toEqual({
      provider: 'provider-test',
      providerSubscriptionId: 'subscription-remote',
      currentItems: reordered,
      proposedItems: reordered,
    });
  });
});

function encodeEvidence(items: readonly SubscriptionChangeItem[]) {
  return encodeSubscriptionPriceMigrationExecutionEvidence(
    {
      provider: 'provider-test',
      providerSubscriptionId: 'subscription-remote',
      currentItems: items,
      proposedItems: items,
    },
    canonicalItems,
    canonicalItems,
  );
}
