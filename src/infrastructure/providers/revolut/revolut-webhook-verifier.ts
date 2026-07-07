import { createHmac } from 'node:crypto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';
import { PayableError } from '../../../domain/errors/payable-error';
import { timingSafeEqual } from '../../../support/hash/timing-safe-equal';
import type { RevolutWebhookPayload } from './revolut-types';

const VERSION = 'v1';
const DEFAULT_TOLERANCE_MS = 300_000;

export class RevolutWebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly toleranceMs = DEFAULT_TOLERANCE_MS,
  ) {}

  verify(input: WebhookVerificationInput): RevolutWebhookPayload {
    const timestamp = header(input.headers, 'revolut-request-timestamp');
    const signature = input.signature || header(input.headers, 'revolut-signature');
    if (!timestamp || !signature) {
      throw new InvalidWebhookSignatureError('revolut');
    }
    this.assertTimestamp(timestamp);
    const expected = this.signature(input.payload, timestamp);
    const signatures = signature.split(',').map((value) => value.trim());
    if (!signatures.some((candidate) => timingSafeEqual(candidate, expected))) {
      throw new InvalidWebhookSignatureError('revolut');
    }
    return parsePayload(input.payload);
  }

  private signature(payload: string, timestamp: string): string {
    const hmac = createHmac('sha256', this.secret)
      .update(`${VERSION}.${timestamp}.${payload}`)
      .digest('hex');
    return `${VERSION}=${hmac}`;
  }

  private assertTimestamp(timestamp: string): void {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || Math.abs(Date.now() - value) > this.toleranceMs) {
      throw new InvalidWebhookSignatureError('revolut', {
        context: { reason: 'timestamp_outside_tolerance' },
      });
    }
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

function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  return entry?.[1];
}
