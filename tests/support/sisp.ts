import type { SispPaymentCorrelationStore } from '../../src/infrastructure/providers/sisp/sisp-types';

export function inertCorrelationStore(): SispPaymentCorrelationStore {
  return {
    record: async () => undefined,
    claim: async () => ({ status: 'missing' }),
    markProcessed: async () => undefined,
  };
}
