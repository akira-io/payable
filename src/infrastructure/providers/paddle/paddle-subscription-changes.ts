import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { withPaddleErrors } from './paddle-errors';
import { toSubscriptionDTO } from './paddle-mappers';
import type { PaddleClient, PaddleSubscriptionPreview } from './paddle-types';

export class PaddleSubscriptionChanges {
  constructor(private readonly client: () => Promise<PaddleClient>) {}

  async preview(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    const paddle = await this.client();
    const preview = await withPaddleErrors(() =>
      paddle.subscriptions.previewUpdate(input.providerSubscriptionId, this.body(input)),
    );
    return mapPaddlePreview(preview);
  }

  async apply(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<SubscriptionDTO> {
    const paddle = await this.client();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.update(input.providerSubscriptionId, this.body(input)),
    );
    return toSubscriptionDTO(subscription);
  }

  private body(input: ProviderSubscriptionChangeInput) {
    return {
      items: input.proposedItems.map((subscriptionItem) => ({
        priceId: subscriptionItem.priceId,
        quantity: subscriptionItem.quantity,
      })),
      prorationBillingMode: paddleProrationPolicy(input.prorationPolicy),
      onPaymentFailure:
        input.paymentFailurePolicy === 'preventChange' ? 'prevent_change' : 'apply_change',
    };
  }
}

export function paddleProrationPolicy(
  policy: ProviderSubscriptionChangeInput['prorationPolicy'],
): string {
  const policies = {
    prorateImmediately: 'prorated_immediately',
    prorateAtNextRenewal: 'prorated_next_billing_period',
    chargeFullImmediately: 'full_immediately',
    chargeFullAtNextRenewal: 'full_next_billing_period',
    none: 'do_not_bill',
  } as const;
  const mapped = policies[policy];
  if (!mapped) {
    throw new ProviderCapabilityNotSupportedError('paddle', `subscriptions.change.${policy}`);
  }
  return mapped;
}

function mapPaddlePreview(preview: PaddleSubscriptionPreview): ProviderSubscriptionChangePreview {
  const result = preview.updateSummary?.result;
  const totals = preview.nextTransaction?.details.totals;
  return {
    immediateAdjustment: result
      ? { direction: result.action, amount: Number(result.amount), currency: result.currencyCode }
      : { direction: 'unknown', amount: null, currency: null },
    nextRenewal: {
      amount: totals ? Number(totals.total) : null,
      date: preview.nextTransaction?.billingPeriod.startsAt
        ? new Date(preview.nextTransaction.billingPeriod.startsAt)
        : null,
      currency: totals?.currencyCode ?? null,
    },
    warnings: [],
    providerLimitations: [],
  };
}
