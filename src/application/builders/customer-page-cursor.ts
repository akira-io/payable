import type { ListCursor } from '../../domain/contracts/list-options.contract';
import { PayableError } from '../../domain/errors/payable-error';

interface CustomerCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
}

export function encodeCustomerCursor(cursor: ListCursor): string {
  const payload: CustomerCursorPayload = {
    v: 1,
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  };
  return btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeCustomerCursor(cursor: string): ListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error('Invalid base64url');
    }
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!isCustomerCursorPayload(parsed)) {
      throw new Error('Invalid customer cursor payload');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid customer cursor timestamp');
    }
    return { createdAt, id: parsed.id };
  } catch (cause) {
    throw new PayableError('The customer cursor is invalid', {
      code: 'CUSTOMER_CURSOR_INVALID',
      cause,
    });
  }
}

function isCustomerCursorPayload(candidate: unknown): candidate is CustomerCursorPayload {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const properties = Object.getOwnPropertyDescriptors(candidate);
  return (
    Object.keys(properties).length === 3 &&
    properties.v?.value === 1 &&
    typeof properties.createdAt?.value === 'string' &&
    typeof properties.id?.value === 'string' &&
    properties.id.value.length > 0
  );
}
