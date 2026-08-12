import type { IncomingHttpHeaders } from 'node:http';
import { InvalidIdempotencyKeyError } from '../../domain/errors/invalid-idempotency-key.error';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const INVALID_REPEATED_HEADER = '\uD800';

export interface CatalogIdempotencyHeaders {
  headers: IncomingHttpHeaders;
  rawHeaders?: readonly string[];
}

export function resolveCatalogIdempotencyHeader(
  input: CatalogIdempotencyHeaders,
): string | undefined {
  if (countRawHeaderOccurrences(input.rawHeaders) > 1) {
    return INVALID_REPEATED_HEADER;
  }

  const matchingHeaders = Object.entries(input.headers).filter(
    ([headerName]) => headerName.toLowerCase() === IDEMPOTENCY_HEADER,
  );
  if (matchingHeaders.length === 0) {
    return undefined;
  }
  if (matchingHeaders.length > 1) {
    return INVALID_REPEATED_HEADER;
  }

  const headerValue = matchingHeaders[0]?.[1];
  if (Array.isArray(headerValue)) {
    if (headerValue.length !== 1) {
      return INVALID_REPEATED_HEADER;
    }
    return headerValue[0] ?? INVALID_REPEATED_HEADER;
  }
  return headerValue ?? INVALID_REPEATED_HEADER;
}

export function requireIdempotencyKey(value: string | string[] | undefined): string {
  if (
    Array.isArray(value) ||
    value === undefined ||
    value === INVALID_REPEATED_HEADER ||
    value !== value.trim()
  ) {
    throw new InvalidIdempotencyKeyError('a single Idempotency-Key header is required');
  }
  try {
    return IdempotencyKey.of(value).toString();
  } catch (error) {
    throw new InvalidIdempotencyKeyError(error instanceof Error ? error.message : undefined);
  }
}

export function requireRequestIdempotencyKey(input: CatalogIdempotencyHeaders): string {
  return requireIdempotencyKey(resolveCatalogIdempotencyHeader(input));
}

export function rawHeadersOf(request: unknown): readonly string[] | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }
  if ('rawHeaders' in request && isStringArray(request.rawHeaders)) {
    return request.rawHeaders;
  }
  if ('raw' in request) {
    return rawHeadersOf(request.raw);
  }
  return undefined;
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

function isStringArray(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === 'string');
}
