import type Stripe from 'stripe';
import type {
  TreasuryWebhookEventType,
  VerifiedTreasuryWebhook,
} from '../../../domain/dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';
import { PayableError } from '../../../domain/errors/payable-error';

const EVENT_MAP: Record<string, TreasuryWebhookEventType> = {
  'treasury.financial_account.created': 'treasury.account.created',
  'treasury.financial_account.closed': 'treasury.account.closed',
  'treasury.financial_account.features_status_updated': 'treasury.account.updated',
  'treasury.transaction.created': 'treasury.transaction.created',
  'treasury.transaction.updated': 'treasury.transaction.updated',
  'treasury.outbound_payment.created': 'treasury.transfer.created',
  'treasury.outbound_payment.updated': 'treasury.transfer.updated',
  'treasury.outbound_transfer.created': 'treasury.transfer.created',
  'treasury.outbound_transfer.updated': 'treasury.transfer.updated',
};

export class StripeTreasuryWebhooks {
  constructor(
    private readonly client: () => Promise<Stripe>,
    private readonly secret: () => string | undefined,
    private readonly connectedAccountId: () => string,
  ) {}

  async verify(input: WebhookVerificationInput): Promise<VerifiedTreasuryWebhook> {
    const secret = this.secret();
    if (!secret) {
      throw new PayableError('Stripe Treasury webhook secret is required', {
        code: 'PROVIDER_WEBHOOK_SECRET_REQUIRED',
        context: { provider: 'stripe-treasury' },
      });
    }
    const stripe = await this.client();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(input.payload, input.signature, secret);
    } catch (error) {
      throw new InvalidWebhookSignatureError('stripe-treasury', { cause: error });
    }
    const expectedAccountId = this.connectedAccountId();
    if (event.account && event.account !== expectedAccountId) {
      throw new PayableError('Stripe Treasury webhook account does not match configuration', {
        code: 'PROVIDER_WEBHOOK_ACCOUNT_MISMATCH',
        context: {
          provider: 'stripe-treasury',
          expectedAccountId,
          actualAccountId: event.account,
        },
      });
    }
    return {
      providerEventId: event.id,
      type: event.type,
      normalizedType: EVENT_MAP[event.type] ?? null,
      occurredAt: new Date(event.created * 1000),
      data: event.data.object as unknown as Record<string, unknown>,
    };
  }
}
