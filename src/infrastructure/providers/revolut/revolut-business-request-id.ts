import { createHash } from 'node:crypto';
import type { OperationContext } from '../../../domain/dtos/common.dto';

const MAX_REQUEST_ID_LENGTH = 40;

export function revolutBusinessRequestId(context: OperationContext): string {
  const value = context.idempotencyKey ?? context.correlationId;
  if (value.length <= MAX_REQUEST_ID_LENGTH) {
    return value;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, MAX_REQUEST_ID_LENGTH);
}
