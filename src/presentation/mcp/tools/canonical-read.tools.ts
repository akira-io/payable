import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CustomerNotFoundError } from '../../../domain/errors/customer-not-found.error';
import { INVOICE_STATUSES } from '../../../domain/value-objects/invoice-status';
import { PAYMENT_STATUSES } from '../../../domain/value-objects/payment-status';
import { SUBSCRIPTION_STATUSES } from '../../../domain/value-objects/subscription-status';
import type { Payable } from '../../../payable';
import { respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { limitShape, tenantShape } from '../schemas';

const pageShape = {
  ...limitShape,
  cursor: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
};
const exactShape = { id: z.string().min(1), ...tenantShape };

export function registerCanonicalReadTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('canonical_customers_list', 'read')) {
    server.registerTool(
      'canonical_customers_list',
      {
        description: 'List canonical customers from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          billableType: z.string().min(1).optional(),
          billableId: z.string().min(1).optional(),
          email: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          includeBindings: z.boolean().optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.customers(undefined, tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            billableType: args.billableType,
            billableId: args.billableId,
            email: args.email,
            name: args.name,
            includeBindings: args.includeBindings,
          }),
        ),
    );
  }
  if (gate('canonical_customer_get', 'read')) {
    server.registerTool(
      'canonical_customer_get',
      {
        description: 'Fetch a canonical customer by its local id.',
        inputSchema: exactShape,
      },
      (args) =>
        respond(async () => {
          const customer = await payable
            .customers(undefined, tenantFrom(args, options))
            .find(args.id);
          if (!customer) throw new CustomerNotFoundError(args.id);
          return customer;
        }),
    );
  }

  if (gate('canonical_products_list', 'read')) {
    server.registerTool(
      'canonical_products_list',
      {
        description: 'List canonical products from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          active: z.boolean().optional(),
          name: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          includeBindings: z.boolean().optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.products(tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            active: args.active,
            name: args.name,
            description: args.description,
            includeBindings: args.includeBindings,
          }),
        ),
    );
  }
  if (gate('canonical_product_get', 'read')) {
    server.registerTool(
      'canonical_product_get',
      { description: 'Fetch a canonical product by its local id.', inputSchema: exactShape },
      (args) => respond(() => payable.products(tenantFrom(args, options)).retrieve(args.id)),
    );
  }

  if (gate('canonical_prices_list', 'read')) {
    server.registerTool(
      'canonical_prices_list',
      {
        description: 'List canonical prices from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          active: z.boolean().optional(),
          productId: z.string().min(1).optional(),
          type: z.enum(['one_time', 'recurring']).optional(),
          lookupKey: z.string().min(1).optional(),
          lookupKeys: z.array(z.string().min(1)).min(1).optional(),
          includeBindings: z.boolean().optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.prices(tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            active: args.active,
            productId: args.productId,
            type: args.type,
            lookupKey: args.lookupKey,
            lookupKeys: args.lookupKeys,
            includeBindings: args.includeBindings,
          }),
        ),
    );
  }
  if (gate('canonical_price_get', 'read')) {
    server.registerTool(
      'canonical_price_get',
      { description: 'Fetch a canonical price by its local id.', inputSchema: exactShape },
      (args) => respond(() => payable.prices(tenantFrom(args, options)).retrieve(args.id)),
    );
  }

  if (gate('canonical_subscriptions_list', 'read')) {
    server.registerTool(
      'canonical_subscriptions_list',
      {
        description: 'List canonical subscriptions from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          customerId: z.string().min(1).optional(),
          status: z.enum(SUBSCRIPTION_STATUSES).optional(),
          canonicalPriceId: z.string().min(1).optional(),
          canonicalProductId: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          includeBindings: z.boolean().optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.canonicalSubscriptions(tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            customerId: args.customerId,
            status: args.status,
            canonicalPriceId: args.canonicalPriceId,
            canonicalProductId: args.canonicalProductId,
            name: args.name,
            includeBindings: args.includeBindings,
          }),
        ),
    );
  }
  if (gate('canonical_subscription_get', 'read')) {
    server.registerTool(
      'canonical_subscription_get',
      { description: 'Fetch a canonical subscription by its local id.', inputSchema: exactShape },
      (args) =>
        respond(() => payable.canonicalSubscriptions(tenantFrom(args, options)).retrieve(args.id)),
    );
  }

  if (gate('canonical_payments_list', 'read')) {
    server.registerTool(
      'canonical_payments_list',
      {
        description: 'List stored payments from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          customerId: z.string().min(1).optional(),
          status: z.enum(PAYMENT_STATUSES).optional(),
          currency: z.string().min(1).optional(),
          reference: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.storedPayments(tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            customerId: args.customerId,
            status: args.status,
            currency: args.currency,
            reference: args.reference,
            description: args.description,
          }),
        ),
    );
  }
  if (gate('canonical_invoices_list', 'read')) {
    server.registerTool(
      'canonical_invoices_list',
      {
        description: 'List canonical invoices from local storage without calling a provider.',
        inputSchema: {
          ...pageShape,
          customerId: z.string().min(1).optional(),
          subscriptionId: z.string().min(1).optional(),
          status: z.enum(INVOICE_STATUSES).optional(),
          number: z.string().min(1).optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.canonicalInvoices(tenantFrom(args, options)).list({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            customerId: args.customerId,
            subscriptionId: args.subscriptionId,
            status: args.status,
            number: args.number,
          }),
        ),
    );
  }
  if (gate('canonical_invoice_get', 'read')) {
    server.registerTool(
      'canonical_invoice_get',
      { description: 'Fetch a canonical invoice by its local id.', inputSchema: exactShape },
      (args) =>
        respond(() => payable.canonicalInvoices(tenantFrom(args, options)).retrieve(args.id)),
    );
  }
  if (gate('canonical_payment_get', 'read')) {
    server.registerTool(
      'canonical_payment_get',
      { description: 'Fetch a stored payment by its local id.', inputSchema: exactShape },
      (args) => respond(() => payable.storedPayments(tenantFrom(args, options)).retrieve(args.id)),
    );
  }

  if (gate('canonical_refunds_list', 'read')) {
    server.registerTool(
      'canonical_refunds_list',
      {
        description: 'List canonical refunds from local storage without calling a provider.',
        inputSchema: { ...pageShape, paymentId: z.string().min(1).optional(), ...tenantShape },
      },
      (args) =>
        respond(() =>
          payable.storedPayments(tenantFrom(args, options)).listRefunds({
            limit: args.limit,
            cursor: args.cursor,
            id: args.id,
            paymentId: args.paymentId,
          }),
        ),
    );
  }
  if (gate('canonical_refund_get', 'read')) {
    server.registerTool(
      'canonical_refund_get',
      { description: 'Fetch a canonical refund by its local id.', inputSchema: exactShape },
      (args) =>
        respond(() => payable.storedPayments(tenantFrom(args, options)).retrieveRefund(args.id)),
    );
  }
}
