import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { RevolutWebhookPayload } from './revolut-types';
import { RevolutWebhookSignatureVerifier } from './revolut-webhook-signature';

export class RevolutWebhookVerifier {
  private readonly signature: RevolutWebhookSignatureVerifier;

  constructor(secret: string, toleranceMs?: number) {
    this.signature = new RevolutWebhookSignatureVerifier('revolut', secret, toleranceMs);
  }

  verify(input: WebhookVerificationInput): RevolutWebhookPayload {
    this.signature.verify(input);
    return parsePayload(input.payload);
  }
}

function parsePayload(payload: string): RevolutWebhookPayload {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new TypeError('payload is not an object');
    }
    const event = (parsed as Record<string, unknown>).event;
    if (typeof event !== 'string') {
      throw new TypeError('payload has no event');
    }
    return parsed as RevolutWebhookPayload;
  } catch (error) {
    throw new PayableError('Revolut webhook payload is invalid', {
      code: 'PROVIDER_WEBHOOK_PAYLOAD_INVALID',
      context: { provider: 'revolut' },
      cause: error,
    });
  }
}
