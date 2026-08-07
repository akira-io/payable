import type { ListCursor } from '../../domain/contracts/list-options.contract';
import { PayableError } from '../../domain/errors/payable-error';

interface CanonicalCatalogCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
}

export function encodeCanonicalCatalogCursor(cursor: ListCursor): string {
  return btoa(
    JSON.stringify({
      v: 1,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    } satisfies CanonicalCatalogCursorPayload),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeCanonicalCatalogCursor(cursor: string): ListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error('Invalid base64url');
    }
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!isCursorPayload(parsed)) {
      throw new Error('Invalid canonical catalog cursor payload');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid canonical catalog cursor timestamp');
    }
    return { createdAt, id: parsed.id };
  } catch (cause) {
    throw new PayableError('The canonical catalog cursor is invalid', {
      code: 'CATALOG_CURSOR_INVALID',
      cause,
    });
  }
}

function isCursorPayload(candidate: unknown): candidate is CanonicalCatalogCursorPayload {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const payload = candidate as Partial<CanonicalCatalogCursorPayload>;
  return (
    payload.v === 1 &&
    typeof payload.createdAt === 'string' &&
    typeof payload.id === 'string' &&
    payload.id.length > 0
  );
}
