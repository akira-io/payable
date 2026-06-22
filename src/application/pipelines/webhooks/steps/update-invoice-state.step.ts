import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class UpdateInvoiceStateStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('UpdateInvoiceStateStep (Phase 6)');
  }
}
