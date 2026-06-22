import { PayableError, type PayableErrorOptions } from './payable-error';

export class InvalidWebhookSignatureError extends PayableError {
  constructor(provider: string, options: PayableErrorOptions = {}) {
    super(`Invalid webhook signature for provider: ${provider}`, {
      ...options,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      context: { provider, ...options.context },
    });
  }
}
