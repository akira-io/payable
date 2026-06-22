import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';

// TODO: Phase 14
export function createFastifyPayablePlugin(_payable: Payable): unknown {
  throw PayableError.notImplemented('createFastifyPayablePlugin (Phase 14)');
}
