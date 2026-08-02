import type { IncomingHttpHeaders } from 'node:http';

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
