import {
  rehydrateSubscriptionMutationIntentBlob,
  type SubscriptionMutationIntentBlob,
} from '../contracts/subscription-mutation-claim-repository.contract';

const PREFIX = 'payable:subscription-mutation-intent:v1:';

export interface SubscriptionMutationValue {
  readonly priceId: string;
  readonly quantity: number;
}

export interface SubscriptionMutationProjection {
  readonly itemId: string;
  readonly source: SubscriptionMutationValue;
  readonly target: SubscriptionMutationValue;
  readonly projectItem: boolean;
  readonly projectSubscriptionPrice: boolean;
  readonly projectSubscriptionQuantity: boolean;
}

export function encodeSubscriptionMutationIntent(
  projection: SubscriptionMutationProjection,
): SubscriptionMutationIntentBlob {
  return rehydrateSubscriptionMutationIntentBlob(`${PREFIX}${JSON.stringify(projection)}`);
}

export function decodeSubscriptionMutationIntent(
  blob: SubscriptionMutationIntentBlob,
): SubscriptionMutationProjection {
  const value = rehydrateSubscriptionMutationIntentBlob(blob).slice(PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalid();
  }
  if (!isObject(parsed) || !isObject(parsed.source) || !isObject(parsed.target)) return invalid();
  return {
    itemId: stringField(parsed, 'itemId'),
    source: mutationValue(parsed.source),
    target: mutationValue(parsed.target),
    projectItem: booleanField(parsed, 'projectItem'),
    projectSubscriptionPrice: booleanField(parsed, 'projectSubscriptionPrice'),
    projectSubscriptionQuantity: booleanField(parsed, 'projectSubscriptionQuantity'),
  };
}

function mutationValue(value: Record<string, unknown>): SubscriptionMutationValue {
  const priceId = stringField(value, 'priceId');
  const quantity = value.quantity;
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return invalid();
  }
  return { priceId, quantity };
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === 'string' && field.length > 0 ? field : invalid();
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];
  return typeof field === 'boolean' ? field : invalid();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new TypeError('Invalid subscription mutation intent');
}
