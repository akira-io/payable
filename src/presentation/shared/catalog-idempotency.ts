import type { IncomingHttpHeaders } from 'node:http';
import { validateCatalogIdempotencyKey } from '../../application/services/catalog/catalog-idempotency-key';
import { InvalidIdempotencyKeyError } from '../../domain/errors/invalid-idempotency-key.error';

const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface CatalogIdempotencyHeaders {
  headers: IncomingHttpHeaders;
  rawHeaders?: readonly string[];
}

export function resolveCatalogIdempotencyHeader(
  input: CatalogIdempotencyHeaders,
): string | undefined {
  if (countRawHeaderOccurrences(input.rawHeaders) > 1) {
    throw new InvalidIdempotencyKeyError();
  }

  const matchingHeaders = Object.entries(input.headers).filter(
    ([headerName]) => headerName.toLowerCase() === IDEMPOTENCY_HEADER,
  );
  if (matchingHeaders.length === 0) {
    return undefined;
  }
  if (matchingHeaders.length > 1) {
    throw new InvalidIdempotencyKeyError();
  }

  const headerValue = matchingHeaders[0]?.[1];
  if (Array.isArray(headerValue)) {
    if (headerValue.length !== 1) {
      throw new InvalidIdempotencyKeyError();
    }
    return validateCatalogIdempotencyKey(headerValue[0]);
  }
  return validateCatalogIdempotencyKey(headerValue);
}

function countRawHeaderOccurrences(rawHeaders?: readonly string[]): number {
  if (!rawHeaders) {
    return 0;
  }
  let occurrences = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === IDEMPOTENCY_HEADER) {
      occurrences += 1;
    }
  }
  return occurrences;
}
