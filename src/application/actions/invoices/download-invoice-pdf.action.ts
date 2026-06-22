import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class DownloadInvoicePdfAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('DownloadInvoicePdfAction (Phase 10)');
  }
}
