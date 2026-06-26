import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { billableObject, limitShape, providerShape, tenantShape } from '../schemas';

const webhookStatus = z.enum(['pending', 'processing', 'processed', 'failed']);

export function registerReadTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('providers_list', 'read')) {
    server.registerTool(
      'providers_list',
      { description: 'List configured payment provider names.' },
      () => respond(async () => payable.providers().names()),
    );
  }

  if (gate('customer_get', 'read')) {
    server.registerTool(
      'customer_get',
      {
        description: 'Fetch the stored customer for a billable.',
        inputSchema: { billable: billableObject, ...providerShape, ...tenantShape },
      },
      (args) =>
        respond(() =>
          payable
            .customers(providerFrom(args, options), tenantFrom(args, options))
            .get(args.billable),
        ),
    );
  }

  if (gate('subscriptions_list', 'read')) {
    server.registerTool(
      'subscriptions_list',
      {
        description: 'List subscriptions for a billable, or across the tenant when omitted.',
        inputSchema: {
          billable: billableObject.optional(),
          ...providerShape,
          ...tenantShape,
          ...limitShape,
        },
      },
      (args) =>
        respond(() => {
          if (args.billable) {
            return payable
              .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
              .subscriptions({ limit: args.limit });
          }
          return payable.subscriptions(tenantFrom(args, options), { limit: args.limit });
        }),
    );
  }

  if (gate('subscription_get', 'read')) {
    server.registerTool(
      'subscription_get',
      {
        description: 'Fetch a named subscription for a billable.',
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
            .get(),
        ),
    );
  }

  if (gate('payments_list', 'read')) {
    server.registerTool(
      'payments_list',
      {
        description: 'List payments for a billable, or across the tenant when omitted.',
        inputSchema: {
          billable: billableObject.optional(),
          ...providerShape,
          ...tenantShape,
          ...limitShape,
        },
      },
      (args) =>
        respond(() => {
          if (args.billable) {
            return payable
              .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
              .payments({ limit: args.limit });
          }
          return payable.payments(tenantFrom(args, options), { limit: args.limit });
        }),
    );
  }

  if (gate('invoices_list', 'read')) {
    server.registerTool(
      'invoices_list',
      {
        description: 'List invoices for a billable.',
        inputSchema: { billable: billableObject, ...providerShape, ...tenantShape, ...limitShape },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .invoices(args.limit),
        ),
    );
  }

  if (gate('invoice_pdf', 'read')) {
    server.registerTool(
      'invoice_pdf',
      {
        description: 'Resolve the downloadable PDF for a provider invoice id.',
        inputSchema: {
          billable: billableObject,
          providerInvoiceId: z.string().min(1),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .invoices(providerFrom(args, options), tenantFrom(args, options))
            .downloadPdf(args.providerInvoiceId, args.billable),
        ),
    );
  }

  if (gate('refunds_list', 'read')) {
    server.registerTool(
      'refunds_list',
      {
        description: 'List refunds for a payment id.',
        inputSchema: {
          paymentId: z.string().min(1),
          ...providerShape,
          ...tenantShape,
          ...limitShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .refunds(providerFrom(args, options), tenantFrom(args, options))
            .list(args.paymentId, { limit: args.limit }),
        ),
    );
  }

  if (gate('audit_logs_query', 'read')) {
    server.registerTool(
      'audit_logs_query',
      {
        description: 'Query the immutable audit log.',
        inputSchema: {
          resourceType: z.string().optional(),
          resourceId: z.string().optional(),
          correlationId: z.string().optional(),
          ...tenantShape,
          ...limitShape,
        },
      },
      (args) =>
        respond(() =>
          payable.auditLogs(tenantFrom(args, options)).run({
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            correlationId: args.correlationId,
            limit: args.limit,
          }),
        ),
    );
  }

  if (gate('webhooks_list', 'read')) {
    server.registerTool(
      'webhooks_list',
      {
        description: 'List stored webhook events.',
        inputSchema: {
          status: webhookStatus.optional(),
          type: z.string().optional(),
          ...providerShape,
          ...tenantShape,
          ...limitShape,
        },
      },
      (args) =>
        respond(() =>
          payable.webhookEvents(tenantFrom(args, options)).list({
            provider: args.provider,
            status: args.status,
            type: args.type,
            limit: args.limit,
          }),
        ),
    );
  }

  if (gate('webhook_get', 'read')) {
    server.registerTool(
      'webhook_get',
      {
        description: 'Fetch a stored webhook event by id.',
        inputSchema: { id: z.string().min(1), ...tenantShape },
      },
      (args) => respond(() => payable.webhookEvents(tenantFrom(args, options)).get(args.id)),
    );
  }
}
