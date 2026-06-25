import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { authorizationFrom, providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { billableObject, moneyObject, providerShape, tenantShape, toMoney } from '../schemas';

export function registerMoneyTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('charge', 'money')) {
    server.registerTool(
      'charge',
      {
        description: 'Charge a one-off amount to a billable.',
        inputSchema: {
          billable: billableObject,
          amount: moneyObject,
          reference: z.string().optional(),
          description: z.string().optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .customer(args.billable, providerFrom(args, options), tenantFrom(args, options))
            .charge({
              amount: toMoney(args.amount),
              reference: args.reference,
              description: args.description,
              authorization: authorizationFrom('charge', args, options),
            }),
        ),
    );
  }

  if (gate('refund', 'money')) {
    server.registerTool(
      'refund',
      {
        description: 'Refund a payment in full or part.',
        inputSchema: {
          paymentId: z.string().min(1),
          amount: moneyObject.optional(),
          reason: z.string().optional(),
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable.refund(
            {
              paymentId: args.paymentId,
              amount: args.amount ? toMoney(args.amount) : undefined,
              reason: args.reason,
              authorization: authorizationFrom('refund', args, options),
            },
            tenantFrom(args, options),
          ),
        ),
    );
  }
}
