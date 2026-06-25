import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { authorizationFrom, providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import {
  billableObject,
  moneyObject,
  providerShape,
  recurringInterval,
  tenantShape,
  toMoney,
} from '../schemas';

const metadata = z.record(z.string(), z.string()).optional();

export function registerCatalogTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('product_create', 'mutate')) {
    server.registerTool(
      'product_create',
      {
        description: 'Create a product with the configured provider.',
        inputSchema: {
          name: z.string().min(1),
          description: z.string().optional(),
          active: z.boolean().optional(),
          metadata,
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.products(providerFrom(args, options), tenantFrom(args, options)).create({
            name: args.name,
            description: args.description,
            active: args.active,
            metadata: args.metadata,
          }),
        ),
    );
  }

  if (gate('product_update', 'mutate')) {
    server.registerTool(
      'product_update',
      {
        description: 'Update an existing provider product.',
        inputSchema: {
          providerProductId: z.string().min(1),
          name: z.string().optional(),
          description: z.string().optional(),
          active: z.boolean().optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.products(providerFrom(args, options), tenantFrom(args, options)).update({
            providerProductId: args.providerProductId,
            name: args.name,
            description: args.description,
            active: args.active,
          }),
        ),
    );
  }

  if (gate('price_create', 'mutate')) {
    server.registerTool(
      'price_create',
      {
        description: 'Create a price for a provider product.',
        inputSchema: {
          providerProductId: z.string().min(1),
          unitAmount: moneyObject,
          interval: recurringInterval.optional(),
          intervalCount: z.number().int().positive().optional(),
          description: z.string().optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.prices(providerFrom(args, options), tenantFrom(args, options)).create({
            providerProductId: args.providerProductId,
            unitAmount: toMoney(args.unitAmount),
            interval: args.interval,
            intervalCount: args.intervalCount,
            description: args.description,
          }),
        ),
    );
  }
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
          return builder.create(authorizationFrom('subscription_create', args, options));
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
            [action](authorizationFrom(name, args, options)),
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
          priceId: z.string().min(1),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .subscription(args.name)
            .swap(args.priceId, authorizationFrom('subscription_swap', args, options)),
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
          quantity: z.number().int().positive(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .subscription(args.name)
            .updateQuantity(
              args.quantity,
              authorizationFrom('subscription_update_quantity', args, options),
            ),
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
              authorization: authorizationFrom('checkout_create', args, options),
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
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .billingPortal(args.returnUrl),
        ),
    );
  }
}
