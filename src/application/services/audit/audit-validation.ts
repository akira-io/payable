import { PayableError } from '../../../domain/errors/payable-error';
import type { AuditPageQuery, AuditRecordInput } from '../../builders/audit-resource';

export interface NormalizedAuditPageQuery extends Omit<AuditPageQuery, 'cursor' | 'limit'> {
  cursor?: string;
  limit: number;
}

const FILTER_FIELDS = [
  'actions',
  'resourceTypes',
  'resourceIds',
  'correlationIds',
  'actorTypes',
  'actorIds',
] as const;

const MAX_LENGTHS = {
  action: 128,
  resourceType: 128,
  resourceId: 255,
  correlationId: 255,
  actorType: 64,
  actorId: 255,
} as const;

export function validateAuditRecord(input: AuditRecordInput): AuditRecordInput {
  for (const field of ['action', 'resourceType', 'resourceId', 'correlationId'] as const) {
    requireBoundedString(input[field], field, MAX_LENGTHS[field]);
  }
  for (const field of ['actorType', 'actorId'] as const) {
    const value = input[field];
    if (value !== undefined && value !== null) {
      requireBoundedString(value, field, MAX_LENGTHS[field]);
    }
  }
  for (const field of ['before', 'after', 'metadata'] as const) {
    validateJsonRecord(input[field], field);
  }
  return input;
}

export function normalizeAuditPageQuery(input: AuditPageQuery): NormalizedAuditPageQuery {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw invalid('limit', 'Audit page limit must be an integer between 1 and 100');
  }
  for (const field of FILTER_FIELDS) {
    const values = input[field];
    if (values !== undefined && values.length === 0) {
      throw invalid(field, `${field} must contain at least one value`);
    }
    values?.forEach((value) => {
      requireBoundedString(value, field, 255);
    });
  }
  for (const field of ['createdAfter', 'createdBefore'] as const) {
    const value = input[field];
    if (value !== undefined && (!(value instanceof Date) || Number.isNaN(value.getTime()))) {
      throw invalid(field, `${field} must be a valid Date`);
    }
  }
  if (
    input.createdAfter &&
    input.createdBefore &&
    input.createdAfter.getTime() >= input.createdBefore.getTime()
  ) {
    throw invalid('createdBefore', 'createdBefore must be later than createdAfter');
  }
  return { ...input, limit };
}

function requireBoundedString(value: string, field: string, maximum: number): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(field, `${field} must be a non-empty string`);
  }
  if (value.length > maximum) {
    throw invalid(field, `${field} must contain at most ${maximum} characters`);
  }
}

function validateJsonRecord(
  value: Record<string, unknown> | null | undefined,
  field: string,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(field, `${field} must be a JSON-compatible record or null`);
  }
  try {
    JSON.stringify(value, (_key, candidate: unknown) => {
      if (
        candidate === undefined ||
        typeof candidate === 'bigint' ||
        typeof candidate === 'function' ||
        typeof candidate === 'symbol'
      ) {
        throw new TypeError('Unsupported JSON value');
      }
      return candidate;
    });
  } catch {
    throw invalid(field, `${field} must be a JSON-compatible record or null`);
  }
}

function invalid(field: string, message: string): PayableError {
  return new PayableError(message, { code: 'AUDIT_INPUT_INVALID', context: { field } });
}
