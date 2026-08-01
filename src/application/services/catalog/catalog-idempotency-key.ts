import type { CatalogPersistenceAction } from '../../../domain/entities/catalog-mutation.entity';
import { InvalidIdempotencyKeyError } from '../../../domain/errors/invalid-idempotency-key.error';
import { hashRequest } from '../../../support/hash/request-hash';

export interface CatalogProviderKeyInput {
  tenantId?: string | null;
  providerName: string;
  action: CatalogPersistenceAction;
  callerKey: string;
}

export function validateCatalogIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidIdempotencyKeyError();
  }
  if (!isWellFormedUnicode(value)) {
    throw new InvalidIdempotencyKeyError();
  }
  const length = [...value].length;
  if (length === 0 || length > 255 || value.trim().length === 0 || value.trim() !== value) {
    throw new InvalidIdempotencyKeyError();
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isHighSurrogate(codeUnit)) {
      const followingCodeUnit = value.charCodeAt(index + 1);
      if (!isLowSurrogate(followingCodeUnit)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (isLowSurrogate(codeUnit)) {
      return false;
    }
  }
  return true;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function catalogIdempotencyScope(
  providerName: string,
  action: CatalogPersistenceAction,
): string {
  return `catalog:${encodeURIComponent(providerName)}:catalog.${action}`;
}

export async function deriveCatalogProviderKey(input: CatalogProviderKeyInput): Promise<string> {
  const tenantScope = input.tenantId == null ? ['default'] : ['tenant', input.tenantId];
  const digest = await hashRequest([
    'payable-catalog-v1',
    tenantScope,
    input.providerName,
    `catalog.${input.action}`,
    input.callerKey,
  ]);
  return `payable:catalog:v1:${digest}`;
}
