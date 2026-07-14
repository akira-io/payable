import { createHmac } from 'node:crypto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';
import { timingSafeEqual } from '../../../support/hash/timing-safe-equal';

const VERSION = 'v1';
const DEFAULT_TOLERANCE_MS = 300_000;

export class RevolutWebhookSignatureVerifier {
  constructor(
    private readonly provider: string,
    private readonly secret: string,
    private readonly toleranceMs = DEFAULT_TOLERANCE_MS,
  ) {}

  verify(input: WebhookVerificationInput): void {
    const timestamp = header(input.headers, 'revolut-request-timestamp');
    const signature = input.signature || header(input.headers, 'revolut-signature');
    if (!timestamp || !signature) {
      throw new InvalidWebhookSignatureError(this.provider);
    }
    this.assertTimestamp(timestamp);
    const expected = this.signature(input.payload, timestamp);
    const signatures = signature.split(',').map((value) => value.trim());
    if (!signatures.some((candidate) => timingSafeEqual(candidate, expected))) {
      throw new InvalidWebhookSignatureError(this.provider);
    }
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
      throw new InvalidWebhookSignatureError(this.provider, {
        context: { reason: 'timestamp_outside_tolerance' },
      });
    }
  }
}

function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lower)?.[1];
}
