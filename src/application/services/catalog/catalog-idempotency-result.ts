import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import { IdempotencyResultPersistenceError } from '../../../domain/errors/idempotency-result-persistence.error';
import { Money } from '../../../domain/value-objects/money';

interface StoredMoney {
  amount: number;
  currency: string;
}

interface StoredPrice extends Omit<PriceDTO, 'unitAmount'> {
  unitAmount: StoredMoney;
}

function isRecord(storedValue: unknown): storedValue is Record<string, unknown> {
  return typeof storedValue === 'object' && storedValue !== null && !Array.isArray(storedValue);
}

function isNullableString(storedValue: unknown): storedValue is string | null {
  return storedValue === null || typeof storedValue === 'string';
}

function isStoredMetadata(storedValue: unknown): storedValue is Record<string, string> | null {
  if (storedValue === null) {
    return true;
  }
  if (!isRecord(storedValue)) {
    return false;
  }
  return Object.values(storedValue).every((metadataValue) => typeof metadataValue === 'string');
}

function isStoredProduct(storedValue: unknown): storedValue is ProductDTO {
  return (
    isRecord(storedValue) &&
    typeof storedValue.providerProductId === 'string' &&
    typeof storedValue.name === 'string' &&
    isNullableString(storedValue.description) &&
    typeof storedValue.active === 'boolean' &&
    isStoredMetadata(storedValue.metadata)
  );
}

function isRecurringInterval(
  storedValue: unknown,
): storedValue is 'day' | 'week' | 'month' | 'year' | null {
  return (
    storedValue === null ||
    storedValue === 'day' ||
    storedValue === 'week' ||
    storedValue === 'month' ||
    storedValue === 'year'
  );
}

function isNullableInteger(storedValue: unknown): storedValue is number | null {
  return storedValue === null || (typeof storedValue === 'number' && Number.isInteger(storedValue));
}

function isStoredMoney(storedValue: unknown): storedValue is StoredMoney {
  return (
    isRecord(storedValue) &&
    typeof storedValue.amount === 'number' &&
    typeof storedValue.currency === 'string'
  );
}

function isStoredPrice(storedValue: unknown): storedValue is StoredPrice {
  return (
    isRecord(storedValue) &&
    typeof storedValue.providerPriceId === 'string' &&
    typeof storedValue.providerProductId === 'string' &&
    isStoredMoney(storedValue.unitAmount) &&
    isRecurringInterval(storedValue.interval) &&
    isNullableInteger(storedValue.intervalCount) &&
    isNullableString(storedValue.description) &&
    typeof storedValue.active === 'boolean'
  );
}

function malformedStoredResponse(resourceType: 'product' | 'price', cause?: unknown): Error {
  return new IdempotencyResultPersistenceError('catalog-response', {
    cause,
    context: { resourceType },
  });
}

export function reviveProduct(storedResponse: unknown): ProductDTO {
  if (!isStoredProduct(storedResponse)) {
    throw malformedStoredResponse('product');
  }
  return storedResponse;
}

export function revivePrice(storedResponse: unknown): PriceDTO {
  if (!isStoredPrice(storedResponse)) {
    throw malformedStoredResponse('price');
  }
  try {
    return {
      ...storedResponse,
      unitAmount: Money.of(storedResponse.unitAmount.amount, storedResponse.unitAmount.currency),
    };
  } catch (error) {
    throw malformedStoredResponse('price', error);
  }
}
