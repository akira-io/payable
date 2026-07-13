import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { DisputeDTO } from '../../../domain/dtos/dispute.dto';
import type { PaymentMethodDTO } from '../../../domain/dtos/payment-method.dto';
import type { PayoutDTO, PayoutStatus } from '../../../domain/dtos/payout.dto';
import type { ProviderWebhookEndpointDTO } from '../../../domain/dtos/provider-webhook-endpoint.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { Money } from '../../../domain/value-objects/money';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import type {
  RevolutCustomer,
  RevolutDispute,
  RevolutOrder,
  RevolutPaymentMethod,
  RevolutPayout,
  RevolutSubscription,
  RevolutWebhook,
} from './revolut-types';

const REFUND_STATUS_BY_STATE: Record<string, RefundStatus> = {
  pending: 'pending',
  processing: 'pending',
  authorised: 'pending',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'failed',
};

const SUBSCRIPTION_STATUS_BY_STATE: Record<string, SubscriptionStatus> = {
  pending: 'incomplete',
  active: 'active',
  overdue: 'past_due',
  paused: 'paused',
  cancelled: 'canceled',
  finished: 'canceled',
};

const PAYOUT_STATUS_BY_STATE: Record<string, PayoutStatus> = {
  processing: 'pending',
  completed: 'paid',
  failed: 'failed',
};

export function toRevolutCheckoutSessionDTO(order: RevolutOrder): CheckoutSessionDTO {
  if (!order.checkout_url) {
    throw new PayableError('Revolut order did not return a checkout URL', {
      code: 'PROVIDER_REVOLUT_CHECKOUT_URL_MISSING',
      context: { provider: 'revolut', orderId: order.id },
    });
  }
  return { id: order.id, url: order.checkout_url };
}

export function toRevolutCustomerDTO(customer: RevolutCustomer): CustomerDTO {
  return {
    providerCustomerId: customer.id,
    email: customer.email ?? null,
    name: customer.full_name ?? null,
  };
}

export function toRevolutPaymentMethodDTO(
  method: RevolutPaymentMethod,
  providerCustomerId: string,
): PaymentMethodDTO {
  return {
    providerPaymentMethodId: method.id,
    providerCustomerId,
    type: method.type,
    brand: method.brand ?? null,
    last4: method.last_four ?? method.debtor_iban_last_four ?? null,
    expiresMonth: method.expiry_month ?? null,
    expiresYear: method.expiry_year ?? null,
  };
}

export function toRevolutDisputeDTO(dispute: RevolutDispute): DisputeDTO {
  return {
    providerDisputeId: dispute.id,
    providerPaymentId: dispute.payment?.order_id ?? dispute.payment?.id ?? null,
    status: dispute.state,
    reason: dispute.reason_code ?? null,
    amount: Money.of(dispute.amount, dispute.currency),
    responseDueAt: dateOrNull(dispute.response_due_date),
    createdAt: dateOrNull(dispute.created_at),
  };
}

export function toRevolutPayoutDTO(payout: RevolutPayout): PayoutDTO {
  return {
    providerPayoutId: payout.id,
    status: PAYOUT_STATUS_BY_STATE[payout.state] ?? 'pending',
    amount:
      payout.amount === undefined || payout.currency === undefined
        ? null
        : Money.of(payout.amount, payout.currency),
    createdAt: dateOrNull(payout.created_at),
    arrivalAt: null,
  };
}

export function toRevolutWebhookEndpointDTO(endpoint: RevolutWebhook): ProviderWebhookEndpointDTO {
  return {
    providerWebhookEndpointId: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    signingSecret: endpoint.signing_secret,
    status: null,
  };
}

export function toRevolutSubscriptionDTO(subscription: RevolutSubscription): SubscriptionDTO {
  return {
    providerSubscriptionId: subscription.id,
    status: subscriptionStatus(subscription.state),
    currentPeriodEnd: null,
    trialEndsAt: dateOrNull(subscription.trial_end_date),
  };
}

export function toRevolutRefundResultDTO(
  order: RevolutOrder,
  amount: RefundResultDTO['amount'],
): RefundResultDTO {
  return {
    providerRefundId: order.id,
    status: refundStatus(order.state),
    amount,
  };
}

function refundStatus(state?: string): RefundStatus {
  if (!state) {
    return 'pending';
  }
  return REFUND_STATUS_BY_STATE[state] ?? 'pending';
}

function subscriptionStatus(state?: string): SubscriptionStatus {
  if (!state) {
    return 'incomplete';
  }
  return SUBSCRIPTION_STATUS_BY_STATE[state] ?? 'incomplete';
}

function dateOrNull(value?: string): Date | null {
  if (!value) {
    return null;
  }
  return new Date(value);
}
