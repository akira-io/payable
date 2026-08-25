import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { toSubscriptionChangeTiming } from '../../../domain/validation/subscription-change-policies';
import { rfc3339DateTimeSchema } from '../../shared/schemas';
import { authorizeTool, providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { billableObject, providerShape, tenantShape } from '../schemas';

export function registerCustomerTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (!gate('customer_sync', 'mutate')) {
    return;
  }
  server.registerTool(
    'customer_sync',
    {
      description: 'Synchronize a logical customer with a named provider account.',
      inputSchema: {
        billable: billableObject,
        provider: z.string().min(1),
        ...tenantShape,
      },
    },
    (args) =>
      respond(async () => {
        authorizeTool('customer_sync', args, options);
        const providerCustomerId = await payable
          .customers(args.provider, tenantFrom(args, options))
          .sync(args.billable);
        return { providerCustomerId };
      }),
  );
}

export function registerSubscriptionTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('subscription_create', 'mutate')) {
    server.registerTool(
      'subscription_create',
      {
        description: 'Create a subscription for a billable.',
        inputSchema: {
          billable: billableObject,
          name: z.string().min(1),
          priceId: z.string().min(1),
          trialDays: z.number().int().nonnegative().optional(),
          coupon: z.string().optional(),
          quantity: z.number().int().positive().optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const builder = payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .newSubscription(args.name)
            .price(args.priceId);
          if (args.trialDays !== undefined) {
            builder.trialDays(args.trialDays);
          }
          if (args.quantity !== undefined) {
            builder.quantity(args.quantity);
          }
          if (args.coupon) {
            builder.coupon(args.coupon);
          }
          return builder.create(authorizeTool('subscription_create', args, options));
        }),
    );
  }

  const manage = (name: string, action: 'cancel' | 'cancelNow' | 'resume') => {
    if (!gate(name, 'mutate')) {
      return;
    }
    server.registerTool(
      name,
      {
        description: `Run ${action} on a named subscription.`,
        inputSchema: {
          billable: billableObject,
          name: z.string().min(1),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .subscription(args.name)
            [action](authorizeTool(name, args, options)),
        ),
    );
  };

  manage('subscription_cancel', 'cancel');
  manage('subscription_cancel_now', 'cancelNow');
  manage('subscription_resume', 'resume');

  if (gate('subscription_swap', 'mutate')) {
    server.registerTool(
      'subscription_swap',
      {
        description: 'Swap a subscription to a new price.',
        inputSchema: {
          billable: billableObject,
          name: z.string().min(1),
          itemId: z.string().min(1).optional(),
          priceId: z.string().min(1),
          effectiveTiming: z.enum(['immediate', 'nextRenewal', 'scheduled']),
          effectiveAt: rfc3339DateTimeSchema.optional(),
          prorationPolicy: z.enum([
            'prorateImmediately',
            'prorateAtNextRenewal',
            'chargeFullImmediately',
            'chargeFullAtNextRenewal',
            'none',
          ]),
          paymentFailurePolicy: z.enum(['preventChange', 'applyChange']),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .subscription(args.name)
            .swap({
              priceId: args.priceId,
              itemId: args.itemId,
              ...toSubscriptionChangeTiming(args),
              prorationPolicy: args.prorationPolicy,
              paymentFailurePolicy: args.paymentFailurePolicy,
              authorization: authorizeTool('subscription_swap', args, options),
            }),
        ),
    );
  }

  if (gate('subscription_update_quantity', 'mutate')) {
    server.registerTool(
      'subscription_update_quantity',
      {
        description: 'Update the quantity on a subscription.',
        inputSchema: {
          billable: billableObject,
          name: z.string().min(1),
          itemId: z.string().min(1).optional(),
          quantity: z.number().int().positive(),
          effectiveTiming: z.enum(['immediate', 'nextRenewal', 'scheduled']),
          effectiveAt: rfc3339DateTimeSchema.optional(),
          prorationPolicy: z.enum([
            'prorateImmediately',
            'prorateAtNextRenewal',
            'chargeFullImmediately',
            'chargeFullAtNextRenewal',
            'none',
          ]),
          paymentFailurePolicy: z.enum(['preventChange', 'applyChange']),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .subscription(args.name)
            .updateQuantity({
              quantity: args.quantity,
              itemId: args.itemId,
              ...toSubscriptionChangeTiming(args),
              prorationPolicy: args.prorationPolicy,
              paymentFailurePolicy: args.paymentFailurePolicy,
              authorization: authorizeTool('subscription_update_quantity', args, options),
            }),
        ),
    );
  }
}

export function registerLinkTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('checkout_create', 'mutate')) {
    server.registerTool(
      'checkout_create',
      {
        description: 'Create a provider checkout session for a subscription.',
        inputSchema: {
          billable: billableObject,
          name: z.string().min(1),
          priceId: z.string().min(1),
          successUrl: z.string().min(1),
          cancelUrl: z.string().min(1),
          reference: z.string().optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .newSubscription(args.name)
            .price(args.priceId)
            .checkout({
              successUrl: args.successUrl,
              cancelUrl: args.cancelUrl,
              reference: args.reference,
              authorization: authorizeTool('checkout_create', args, options),
            }),
        ),
    );
  }

  if (gate('billing_portal', 'mutate')) {
    server.registerTool(
      'billing_portal',
      {
        description: 'Create a provider billing portal session.',
        inputSchema: {
          billable: billableObject,
          returnUrl: z.string().min(1),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          authorizeTool('billing_portal', args, options);
          return payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .billingPortal(args.returnUrl);
        }),
    );
  }
}
