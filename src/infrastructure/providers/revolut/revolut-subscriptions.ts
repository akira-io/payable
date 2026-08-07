import type { ResumeSubscriptionInput } from '../../../domain/contracts/payment-provider.contract';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { requireSubscriptionChangePolicies } from '../../../domain/validation/subscription-change-policies';
import { toRevolutCheckoutSessionDTO, toRevolutSubscriptionDTO } from './revolut-mappers';
import { reconcileRevolutSubscriptionWebhook } from './revolut-subscription-webhook-reconciliation';
import type {
  RevolutOrder,
  RevolutRequest,
  RevolutSubscription,
  RevolutSubscriptionChangePlanPayload,
  RevolutSubscriptionCreationPayload,
} from './revolut-types';

export class RevolutSubscriptions {
  constructor(private readonly request: RevolutRequest) {}

  async createCheckout(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const planVariationId = checkoutPlanVariationId(input);
    const subscription = await this.createRevolutSubscription(
      {
        plan_variation_id: planVariationId,
        customer_id: input.providerCustomerId,
        external_reference: input.reference,
        setup_order_redirect_url: input.successUrl || undefined,
        trial_duration: trialDuration(input.trialDays),
      },
      ctx,
    );
    if (!subscription.setup_order_id) {
      throw new PayableError('Revolut subscription did not return a setup order id', {
        code: 'PROVIDER_REVOLUT_SETUP_ORDER_MISSING',
        context: { provider: 'revolut', subscriptionId: subscription.id },
      });
    }
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(subscription.setup_order_id)}`,
      { method: 'GET' },
    );
    return toRevolutCheckoutSessionDTO(order);
  }

  async create(input: CreateSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const planVariationId = directPlanVariationId(input);
    const subscription = await this.createRevolutSubscription(
      {
        plan_variation_id: planVariationId,
        customer_id: input.providerCustomerId,
        trial_duration: trialDuration(input.trialDays),
      },
      ctx,
    );
    return toRevolutSubscriptionDTO(subscription);
  }

  async update(input: UpdateSubscriptionInput, _ctx: OperationContext): Promise<SubscriptionDTO> {
    assertSupportedQuantity(input.quantity);
    if (input.priceId) {
      const policies = requireSubscriptionChangePolicies(input);
      if (
        policies.effectiveTiming !== 'nextRenewal' ||
        policies.prorationPolicy !== 'none' ||
        policies.paymentFailurePolicy !== 'applyChange'
      ) {
        throw new ProviderCapabilityNotSupportedError(
          'revolut',
          'subscriptions.change.nextRenewal.none.applyChange',
        );
      }
      const body: RevolutSubscriptionChangePlanPayload = {
        plan_variation_id: input.priceId,
        scheduled: 'at_cycle_end',
      };
      await this.request<null>(
        `/api/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}/change-plan`,
        { method: 'POST', body },
      );
    }
    return this.retrieve(input.providerSubscriptionId);
  }

  async previewChange(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    assertRevolutChangePolicies(input);
    return {
      immediateAdjustment: { direction: 'none', amount: 0, currency: null },
      nextRenewal: { amount: null, date: input.renewalDate, currency: null },
      warnings: [],
      providerLimitations: [
        'Revolut Merchant API does not expose monetary previews for cycle-end plan changes.',
      ],
    };
  }

  async applyChange(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionDTO> {
    assertRevolutChangePolicies(input);
    const changedItem = input.proposedItems.find((proposedItem) => {
      const currentItem = input.currentItems.find(
        (candidate) => candidate.itemId === proposedItem.itemId,
      );
      return currentItem?.priceId !== proposedItem.priceId;
    });
    if (!changedItem) {
      throw new ProviderCapabilityNotSupportedError('revolut', 'subscriptions.change-quantity');
    }
    return this.update(
      {
        providerSubscriptionId: input.providerSubscriptionId,
        priceId: changedItem.priceId,
        effectiveTiming: input.effectiveTiming,
        prorationPolicy: input.prorationPolicy,
        paymentFailurePolicy: input.paymentFailurePolicy,
        calculatedAt: input.calculatedAt,
      },
      context,
    );
  }

  async cancel(input: CancelSubscriptionInput, _ctx: OperationContext): Promise<SubscriptionDTO> {
    if (input.immediately !== true) {
      throw new ProviderCapabilityNotSupportedError(
        'revolut',
        'period-end subscription cancellation',
      );
    }
    await this.request<null>(
      `/api/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}/cancel`,
      { method: 'POST' },
    );
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'canceled',
      currentPeriodEnd: null,
      trialEndsAt: null,
    };
  }

  async resume(_input: ResumeSubscriptionInput, _ctx: OperationContext): Promise<SubscriptionDTO> {
    throw new ProviderCapabilityNotSupportedError('revolut', 'subscription resume');
  }

  async retrieve(providerSubscriptionId: string): Promise<SubscriptionDTO> {
    const subscription = await this.request<RevolutSubscription>(
      `/api/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      { method: 'GET' },
    );
    return toRevolutSubscriptionDTO(subscription);
  }

  async reconcileWebhook(verified: VerifiedWebhook): Promise<SubscriptionDTO | null> {
    const event = reconcileRevolutSubscriptionWebhook(verified);
    if (!event) {
      return null;
    }
    const current = await this.retrieve(event.providerSubscriptionId);
    return {
      ...event,
      trialEndsAt: current.trialEndsAt,
      items: current.items,
    };
  }

  private createRevolutSubscription(
    body: RevolutSubscriptionCreationPayload,
    ctx: OperationContext,
  ): Promise<RevolutSubscription> {
    return this.request<RevolutSubscription>('/api/subscriptions', {
      method: 'POST',
      body,
      idempotencyKey: ctx.idempotencyKey,
    });
  }
}

function assertRevolutChangePolicies(input: ProviderSubscriptionChangeInput): void {
  const supported =
    input.effectiveTiming === 'nextRenewal' &&
    input.prorationPolicy === 'none' &&
    input.paymentFailurePolicy === 'applyChange';
  if (!supported) {
    throw new ProviderCapabilityNotSupportedError(
      'revolut',
      'subscriptions.change.nextRenewal.none.applyChange',
    );
  }
}

function checkoutPlanVariationId(input: CreateCheckoutSessionInput): string {
  const item = input.lineItems[0];
  if (!item || input.lineItems.length !== 1) {
    throw new ProviderCapabilityNotSupportedError('revolut', 'multi-item subscription checkout');
  }
  if (item.quantity !== 1) {
    throw new ProviderCapabilityNotSupportedError('revolut', 'subscription checkout quantities');
  }
  return item.priceId;
}

function directPlanVariationId(input: CreateSubscriptionInput): string {
  if (input.coupon) {
    throw new ProviderCapabilityNotSupportedError('revolut', 'subscription coupons');
  }
  assertSupportedQuantity(input.quantity);
  const item = input.items?.[0];
  if (input.items && input.items.length > 1) {
    throw new ProviderCapabilityNotSupportedError('revolut', 'multi-item subscriptions');
  }
  if (item) {
    assertSupportedQuantity(item.quantity);
  }
  return item?.priceId ?? input.priceId;
}

function assertSupportedQuantity(quantity?: number): void {
  if (quantity === undefined || quantity === 1) {
    return;
  }
  throw new ProviderCapabilityNotSupportedError('revolut', 'subscription quantities');
}

function trialDuration(days?: number): string | undefined {
  if (days === undefined) {
    return undefined;
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new PayableError(`Revolut trial days must be a non-negative integer, got ${days}`, {
      code: 'PROVIDER_REQUEST_INVALID',
      context: { provider: 'revolut', trialDays: days },
    });
  }
  return `P${days}D`;
}
