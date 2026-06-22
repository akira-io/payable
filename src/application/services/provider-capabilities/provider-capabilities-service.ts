import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class ProviderCapabilitiesService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ProviderCapabilitiesService (Phase 4)');
  }
}
