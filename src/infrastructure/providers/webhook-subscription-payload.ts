import { PayableError } from '../../domain/errors/payable-error';

export function assertSubscriptionPayload(data: Record<string, unknown>, provider: string): void {
  if (typeof data.id !== 'string' || typeof data.status !== 'string') {
    throw new PayableError('Webhook subscription payload is missing id or status', {
      code: 'WEBHOOK_SUBSCRIPTION_PAYLOAD_INVALID',
      context: { provider },
    });
  }
}
