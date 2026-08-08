import type { ListCursor } from '../../../domain/contracts/list-options.contract';
import { PayableError } from '../../../domain/errors/payable-error';

const CURSOR_VERSION = 1;
const DEFAULT_ORDER_VERSION = 'created_at_desc_id_desc_v1';

interface CollectionFilterObject {
  readonly [key: string]: CollectionFilterValue;
}

type CollectionFilterValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly CollectionFilterValue[]
  | CollectionFilterObject;

export interface CollectionCursorContext {
  resource: string;
  tenantId: string | null;
  filters: Readonly<Record<string, CollectionFilterValue>>;
  orderVersion?: string;
}

interface CollectionCursorPayload {
  v: 1;
  context: string;
  createdAt: string;
  id: string;
}

export function encodeCollectionCursor(
  boundary: ListCursor,
  context: CollectionCursorContext,
): string {
  const payload: CollectionCursorPayload = {
    v: CURSOR_VERSION,
    context: serializeContext(context),
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeCollectionCursor(
  cursor: string,
  context: CollectionCursorContext,
): ListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error('Invalid base64url');
    }
    const parsed: unknown = JSON.parse(fromBase64Url(cursor));
    if (!isCursorPayload(parsed) || parsed.context !== serializeContext(context)) {
      throw new Error('Invalid collection cursor context');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid collection cursor timestamp');
    }
    return { createdAt, id: parsed.id };
  } catch (cause) {
    throw new PayableError('The collection cursor is invalid', {
      code: 'COLLECTION_CURSOR_INVALID',
      cause,
    });
  }
}

function serializeContext(context: CollectionCursorContext): string {
  return JSON.stringify({
    resource: context.resource,
    tenantId: context.tenantId,
    filters: stableValue(context.filters),
    orderVersion: context.orderVersion ?? DEFAULT_ORDER_VERSION,
  });
}

function stableValue(value: CollectionFilterValue): CollectionFilterValue {
  if (isCollectionFilterArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const sorted: Record<string, CollectionFilterValue> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) {
      sorted[key] = stableValue(entry);
    }
  }
  return sorted;
}

function isCollectionFilterArray(
  value: CollectionFilterValue,
): value is readonly CollectionFilterValue[] {
  return Array.isArray(value);
}

function isCursorPayload(candidate: unknown): candidate is CollectionCursorPayload {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const payload = candidate as Partial<CollectionCursorPayload>;
  return (
    payload.v === CURSOR_VERSION &&
    typeof payload.context === 'string' &&
    typeof payload.createdAt === 'string' &&
    typeof payload.id === 'string' &&
    payload.id.length > 0
  );
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
