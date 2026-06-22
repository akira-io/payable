import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';

// TODO: Phase 8
export function createExpressPayableRoutes(_payable: Payable): unknown {
  throw PayableError.notImplemented('createExpressPayableRoutes (Phase 8)');
}
