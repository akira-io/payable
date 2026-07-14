import { createHash } from 'node:crypto';
import type {
  TreasuryWebhookEventType,
  VerifiedTreasuryWebhook,
} from '../../../domain/dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { RevolutBusinessWebhookPayload } from './revolut-business-types';
import { RevolutWebhookSignatureVerifier } from './revolut-webhook-signature';

const PROVIDER = 'revolut-business-treasury';
const EVENT_MAP: Record<string, TreasuryWebhookEventType> = {
  TransactionCreated: 'treasury.transaction.created',
  TransactionStateChanged: 'treasury.transaction.updated',
  PayoutLinkCreated: 'treasury.payout_link.created',
  PayoutLinkStateChanged: 'treasury.payout_link.updated',
};

export class RevolutBusinessWebhooks {
  private readonly signature?: RevolutWebhookSignatureVerifier;

  constructor(secret?: string, toleranceMs?: number) {
    if (secret) {
      this.signature = new RevolutWebhookSignatureVerifier(PROVIDER, secret, toleranceMs);
    }
  }

  verify(input: WebhookVerificationInput): VerifiedTreasuryWebhook {
    if (!this.signature) {
      throw new PayableError('Revolut Business webhook secret is required', {
        code: 'PROVIDER_WEBHOOK_SECRET_REQUIRED',
        context: { provider: PROVIDER },
      });
    }
    this.signature.verify(input);
    const event = parsePayload(input.payload);
    return {
      providerEventId: `revolut-business:${createHash('sha256').update(input.payload).digest('hex')}`,
      type: event.event,
      normalizedType: EVENT_MAP[event.event] ?? null,
      occurredAt: parseTimestamp(event.timestamp),
      data: event.data,
    };
  }
}

function parsePayload(payload: string): RevolutBusinessWebhookPayload {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (typeof parsed.event !== 'string' || !isRecord(parsed.data)) {
      throw new TypeError('payload has no event or data object');
    }
    return parsed as unknown as RevolutBusinessWebhookPayload;
  } catch (error) {
    throw new PayableError('Revolut Business webhook payload is invalid', {
      code: 'PROVIDER_WEBHOOK_PAYLOAD_INVALID',
      context: { provider: PROVIDER },
      cause: error,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
