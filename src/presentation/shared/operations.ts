import type { z } from 'zod';
import type { AuthorizationContext } from '../../application/policies/authorization-context';
import type { Billable } from '../../application/builders/billable';
import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { Refund } from '../../domain/entities/refund.entity';
import type { Subscription } from '../../domain/entities/subscription.entity';
import type { Payable } from '../../payable';
import {
  type checkoutBodySchema,
  type manageSubscriptionBodySchema,
  parseMoneyInput,
  type refundBodySchema,
  type swapSubscriptionBodySchema,
} from './schemas';

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type RefundBody = z.infer<typeof refundBodySchema>;
export type ManageSubscriptionBody = z.infer<typeof manageSubscriptionBodySchema>;
export type SwapSubscriptionBody = z.infer<typeof swapSubscriptionBodySchema>;
export type ManageSubscriptionAction = 'cancel' | 'cancelNow' | 'resume';

export function runCheckout(
  payable: Payable,
  body: CheckoutBody,
  tenantId: string | null,
  authorization?: AuthorizationContext,
): Promise<CheckoutSessionDTO> {
  const builder = payable
    .customer(body.billable, undefined, tenantId)
    .newSubscription(body.subscription.name)
    .price(body.subscription.price);
  if (body.subscription.trialDays !== undefined) {
    builder.trialDays(body.subscription.trialDays);
  }
  if (body.subscription.coupon) {
    builder.coupon(body.subscription.coupon);
  }
  return builder.checkout({
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    authorization,
  });
}

export function runManageSubscription(
  payable: Payable,
  action: ManageSubscriptionAction,
  name: string,
  billable: Billable,
  tenantId: string | null,
  authorization?: AuthorizationContext,
): Promise<Subscription> {
  return payable.customer(billable, undefined, tenantId).subscription(name)[action](authorization);
}

export function runSwapSubscription(
  payable: Payable,
  name: string,
  body: SwapSubscriptionBody,
  tenantId: string | null,
  authorization?: AuthorizationContext,
): Promise<Subscription> {
  return payable
    .customer(body.billable, undefined, tenantId)
    .subscription(name)
    .swap(body.price, authorization);
}

export function runRefund(
  payable: Payable,
  body: RefundBody,
  tenantId: string | null,
  authorization?: AuthorizationContext,
): Promise<Refund> {
  return payable.refund(
    {
      paymentId: body.paymentId,
      amount: body.amount ? parseMoneyInput(body.amount) : undefined,
      reason: body.reason,
      authorization,
    },
    tenantId,
  );
}
