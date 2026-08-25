import type {
  SubscriptionPriceMigrationAdjustment,
  SubscriptionPriceMigrationItemSnapshot,
  SubscriptionPriceMigrationRenewal,
  SubscriptionPriceSnapshot,
} from '../../../domain/entities';
import { CurrencyManager } from '../../../domain/value-objects/currency';

export interface NormalizedSubscriptionPriceMigrationJson {
  sourcePrice: SubscriptionPriceSnapshot;
  targetPrice: SubscriptionPriceSnapshot;
  currentItems: SubscriptionPriceMigrationItemSnapshot[];
  proposedItems: SubscriptionPriceMigrationItemSnapshot[];
  immediateAdjustment: SubscriptionPriceMigrationAdjustment;
  nextRenewal: SubscriptionPriceMigrationRenewal;
  warnings: string[];
  providerLimitations: string[];
}

export function normalizeSubscriptionPriceMigrationJson(input: {
  sourcePrice: unknown;
  targetPrice: unknown;
  currentItems: unknown;
  proposedItems: unknown;
  immediateAdjustment: unknown;
  nextRenewal: unknown;
  warnings: unknown;
  providerLimitations: unknown;
}): NormalizedSubscriptionPriceMigrationJson {
  return {
    sourcePrice: normalizePrice(input.sourcePrice, 'source_price'),
    targetPrice: normalizePrice(input.targetPrice, 'target_price'),
    currentItems: normalizeItems(input.currentItems, 'current_items'),
    proposedItems: normalizeItems(input.proposedItems, 'proposed_items'),
    immediateAdjustment: normalizeAdjustment(input.immediateAdjustment),
    nextRenewal: normalizeRenewal(input.nextRenewal),
    warnings: normalizeStrings(input.warnings, 'warnings'),
    providerLimitations: normalizeStrings(input.providerLimitations, 'provider_limitations'),
  };
}

export function decodeSubscriptionPriceMigrationJson(input: {
  sourcePrice: string;
  targetPrice: string;
  currentItems: string;
  proposedItems: string;
  immediateAdjustment: string;
  nextRenewal: string;
  warnings: string;
  providerLimitations: string;
}): NormalizedSubscriptionPriceMigrationJson {
  return normalizeSubscriptionPriceMigrationJson({
    sourcePrice: parseJson(input.sourcePrice, 'source_price'),
    targetPrice: parseJson(input.targetPrice, 'target_price'),
    currentItems: parseJson(input.currentItems, 'current_items'),
    proposedItems: parseJson(input.proposedItems, 'proposed_items'),
    immediateAdjustment: parseJson(input.immediateAdjustment, 'immediate_adjustment'),
    nextRenewal: parseJson(input.nextRenewal, 'next_renewal'),
    warnings: parseJson(input.warnings, 'warnings'),
    providerLimitations: parseJson(input.providerLimitations, 'provider_limitations'),
  });
}

function normalizeStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) invalid(label);
  return value.map((entry, index) => stringValue(entry, `${label}[${index}]`));
}

function normalizePrice(value: unknown, label: string): SubscriptionPriceSnapshot {
  const object = exactObject(value, label, [
    'id',
    'productId',
    'amount',
    'currency',
    'interval',
    'intervalCount',
  ]);
  return {
    id: nonEmptyString(object.id, `${label}.id`),
    productId: nonEmptyString(object.productId, `${label}.productId`),
    amount: safeInteger(object.amount, `${label}.amount`),
    currency: CurrencyManager.normalize(nonEmptyString(object.currency, `${label}.currency`)),
    interval:
      object.interval === null ? null : nonEmptyString(object.interval, `${label}.interval`),
    intervalCount:
      object.intervalCount === null
        ? null
        : positiveInteger(object.intervalCount, `${label}.intervalCount`),
  };
}

function normalizeItems(value: unknown, label: string): SubscriptionPriceMigrationItemSnapshot[] {
  if (!Array.isArray(value)) invalid(label);
  return value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    const object = exactObject(item, itemLabel, ['id', 'priceId', 'quantity']);
    return {
      id: nonEmptyString(object.id, `${itemLabel}.id`),
      priceId: nonEmptyString(object.priceId, `${itemLabel}.priceId`),
      quantity: positiveInteger(object.quantity, `${itemLabel}.quantity`),
    };
  });
}

function normalizeAdjustment(value: unknown): SubscriptionPriceMigrationAdjustment {
  const label = 'immediate_adjustment';
  const object = exactObject(value, label, ['direction', 'amount', 'currency']);
  const direction = object.direction;
  if (
    direction !== 'charge' &&
    direction !== 'credit' &&
    direction !== 'none' &&
    direction !== 'unknown'
  ) {
    invalid(`${label}.direction`);
  }
  return {
    direction,
    amount: object.amount === null ? null : safeInteger(object.amount, `${label}.amount`),
    currency:
      object.currency === null
        ? null
        : CurrencyManager.normalize(nonEmptyString(object.currency, `${label}.currency`)),
  };
}

function normalizeRenewal(value: unknown): SubscriptionPriceMigrationRenewal {
  const label = 'next_renewal';
  const object = exactObject(value, label, ['amount', 'currency', 'date']);
  return {
    amount: object.amount === null ? null : safeInteger(object.amount, `${label}.amount`),
    currency:
      object.currency === null
        ? null
        : CurrencyManager.normalize(nonEmptyString(object.currency, `${label}.currency`)),
    date: object.date === null ? null : validDate(object.date, `${label}.date`),
  };
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

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    invalid(label);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(label);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(label);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(label);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = safeInteger(value, label);
  if (number <= 0) invalid(label);
  return number;
}

function validDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) && typeof value !== 'string') invalid(label);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(label);
  return date;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(label: string): never {
  throw new Error(`Invalid subscription price migration JSON: ${label}`);
}
