import {
  rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob,
  type SubscriptionPriceMigrationExecutionEvidenceBlob,
} from '../contracts/subscription-price-migration-repository.contract';
import type { SubscriptionChangeItem } from '../dtos/subscription-change.dto';
import type { SubscriptionPriceMigrationItemSnapshot } from '../entities/subscription-price-migration.entity';

export interface SubscriptionPriceMigrationExecutionEvidence {
  readonly provider: string;
  readonly providerSubscriptionId: string;
  readonly currentItems: readonly SubscriptionChangeItem[];
  readonly proposedItems: readonly SubscriptionChangeItem[];
}

const PREFIX = 'payable:subscription-price-migration-evidence:v1:';

export function encodeSubscriptionPriceMigrationExecutionEvidence(
  evidence: SubscriptionPriceMigrationExecutionEvidence,
  currentItems: readonly SubscriptionPriceMigrationItemSnapshot[],
  proposedItems: readonly SubscriptionPriceMigrationItemSnapshot[],
): SubscriptionPriceMigrationExecutionEvidenceBlob {
  return rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(
    `${PREFIX}${JSON.stringify(normalizeEvidence(evidence, currentItems, proposedItems))}`,
  );
}

export function decodeSubscriptionPriceMigrationExecutionEvidence(
  value: SubscriptionPriceMigrationExecutionEvidenceBlob,
  currentItems: readonly SubscriptionPriceMigrationItemSnapshot[],
  proposedItems: readonly SubscriptionPriceMigrationItemSnapshot[],
): SubscriptionPriceMigrationExecutionEvidence {
  let parsed: unknown;
  try {
    const rehydrated = rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(value);
    parsed = JSON.parse(rehydrated.slice(PREFIX.length));
  } catch {
    return invalid('provider_evidence');
  }
  return normalizeEvidence(parsed, currentItems, proposedItems);
}

function normalizeEvidence(
  value: unknown,
  currentItems: readonly SubscriptionPriceMigrationItemSnapshot[],
  proposedItems: readonly SubscriptionPriceMigrationItemSnapshot[],
): SubscriptionPriceMigrationExecutionEvidence {
  const label = 'provider_evidence';
  const object = exactObject(value, label, [
    'provider',
    'providerSubscriptionId',
    'currentItems',
    'proposedItems',
  ]);
  const evidence = {
    provider: nonEmptyString(object.provider, `${label}.provider`),
    providerSubscriptionId: nonEmptyString(
      object.providerSubscriptionId,
      `${label}.providerSubscriptionId`,
    ),
    currentItems: normalizeProviderItems(object.currentItems, `${label}.currentItems`),
    proposedItems: normalizeProviderItems(object.proposedItems, `${label}.proposedItems`),
  };
  assertAligned(currentItems, evidence.currentItems, `${label}.currentItems`);
  assertAligned(proposedItems, evidence.proposedItems, `${label}.proposedItems`);
  return evidence;
}

function assertAligned(
  canonical: readonly SubscriptionPriceMigrationItemSnapshot[],
  provider: readonly SubscriptionChangeItem[],
  label: string,
): void {
  if (canonical.length !== provider.length) invalid(label);
  const canonicalById = new Map(canonical.map((item) => [item.id, item]));
  if (canonicalById.size !== canonical.length) invalid(label);
  const providerIds = new Set<string>();
  for (const item of provider) {
    const canonicalItem = canonicalById.get(item.itemId);
    if (
      providerIds.has(item.itemId) ||
      !canonicalItem ||
      canonicalItem.quantity !== item.quantity
    ) {
      invalid(label);
    }
    providerIds.add(item.itemId);
  }
}

function normalizeProviderItems(value: unknown, label: string): SubscriptionChangeItem[] {
  if (!Array.isArray(value)) invalid(label);
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const object = exactObject(entry, itemLabel, [
      'itemId',
      'providerItemId',
      'priceId',
      'quantity',
    ]);
    return {
      itemId: nonEmptyString(object.itemId, `${itemLabel}.itemId`),
      providerItemId:
        object.providerItemId === null
          ? null
          : nonEmptyString(object.providerItemId, `${itemLabel}.providerItemId`),
      priceId: nonEmptyString(object.priceId, `${itemLabel}.priceId`),
      quantity: positiveInteger(object.quantity, `${itemLabel}.quantity`),
    };
  });
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isObject(value)) invalid(label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(label);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(label);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid(label);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(label: string): never {
  throw new Error(`Invalid subscription price migration execution evidence: ${label}`);
}
