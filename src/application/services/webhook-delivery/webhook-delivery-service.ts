import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 11
export class WebhookDeliveryService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('WebhookDeliveryService (Phase 11)');
  }
}
