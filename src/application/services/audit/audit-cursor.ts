import { PayableError } from '../../../domain/errors/payable-error';

interface AuditCursorPayload {
  v: 1;
  before: number;
}

export function encodeAuditCursor(sequence: number): string {
  return toBase64Url(JSON.stringify({ v: 1, before: sequence } satisfies AuditCursorPayload));
}

export function decodeAuditCursor(cursor: string): number {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(cursor));
    if (!isAuditCursorPayload(parsed)) {
      throw new Error('Invalid audit cursor payload');
    }
    return parsed.before;
  } catch (cause) {
    throw new PayableError('The audit cursor is invalid', {
      code: 'AUDIT_CURSOR_INVALID',
      cause,
    });
  }
}

function isAuditCursorPayload(value: unknown): value is AuditCursorPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = Object.getOwnPropertyDescriptors(value);
  return (
    Object.keys(candidate).length === 2 &&
    candidate.v?.value === 1 &&
    typeof candidate.before?.value === 'number' &&
    Number.isInteger(candidate.before.value) &&
    candidate.before.value >= 1
  );
}

function toBase64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Invalid base64url');
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}
