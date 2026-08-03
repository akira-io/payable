import { PriceLookupKeyInvalidError } from '../errors/price-lookup-key-invalid.error';

export const PRICE_LOOKUP_KEY_MAX_LENGTH = 200;
export const PRICE_LOOKUP_KEYS_MAX_ITEMS = 10;

export function validateLookupKey(value: unknown, field = 'lookupKey'): string {
  if (typeof value !== 'string') {
    throw invalid(field, 'must be a string');
  }
  if (!isWellFormedUnicode(value)) {
    throw invalid(field, 'must be well-formed Unicode');
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw invalid(field, 'must not be empty');
  }
  if ([...value].length > PRICE_LOOKUP_KEY_MAX_LENGTH) {
    throw invalid(field, 'exceeds the maximum length', PRICE_LOOKUP_KEY_MAX_LENGTH);
  }
  return value;
}

export function validateLookupKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalid('lookupKeys', 'must be an array');
  }
  if (value.length > PRICE_LOOKUP_KEYS_MAX_ITEMS) {
    throw invalid('lookupKeys', 'exceeds the maximum item count', PRICE_LOOKUP_KEYS_MAX_ITEMS);
  }
  const lookupKeys: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    lookupKeys.push(validateLookupKey(value[index], `lookupKeys[${index}]`));
  }
  return lookupKeys;
}

export function validateTransferLookupKey(value: unknown, lookupKey: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw invalid('transferLookupKey', 'must be a boolean');
  }
  if (value) {
    validateLookupKey(lookupKey);
  }
  return value;
}

function invalid(field: string, reason: string, maximum?: number): PriceLookupKeyInvalidError {
  return new PriceLookupKeyInvalidError(field, reason, maximum);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const followingCodeUnit = value.charCodeAt(index + 1);
      if (
        !Number.isInteger(followingCodeUnit) ||
        followingCodeUnit < 0xdc00 ||
        followingCodeUnit > 0xdfff
      ) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
