import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { authorizeTool, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { moneyObject, requiredIdempotencyKeyShape, tenantShape, toMoney } from '../schemas';

const collectionMethod = z.enum([
  'cash',
  'bank_transfer',
  'cheque',
  'money_order',
  'mobile_money',
  'card_terminal',
  'other',
]);

export function registerCanonicalPaymentTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('canonical_payment_record_local', 'money')) {
    server.registerTool(
      'canonical_payment_record_local',
      {
        description: 'Record a providerless payment with collection evidence.',
        inputSchema: {
          customerId: z.string().min(1),
          amount: moneyObject,
          status: z.enum(['pending', 'succeeded']),
          collectionMethod,
          occurredAt: z.string().datetime().optional(),
          externalReference: z.string().optional(),
          description: z.string().optional(),
          ...requiredIdempotencyKeyShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = authorizeTool('canonical_payment_record_local', args, options);
          return payable.storedPayments(tenantFrom(args, options)).record({
            customerId: args.customerId,
            amount: toMoney(args.amount),
            status: args.status,
            collectionMethod: args.collectionMethod,
            occurredAt: args.occurredAt ? new Date(args.occurredAt) : undefined,
            externalReference: args.externalReference,
            description: args.description,
            authorization,
            idempotencyKey: args.idempotencyKey,
          });
        }),
    );
  }

  if (gate('canonical_payment_refund_local', 'money')) {
    server.registerTool(
      'canonical_payment_refund_local',
      {
        description: 'Record a full or partial providerless refund.',
        inputSchema: {
          paymentId: z.string().min(1),
          amount: moneyObject.optional(),
          collectionMethod,
          occurredAt: z.string().datetime().optional(),
          externalReference: z.string().optional(),
          reason: z.string().optional(),
          ...requiredIdempotencyKeyShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = authorizeTool('canonical_payment_refund_local', args, options);
          return payable.storedPayments(tenantFrom(args, options)).refundLocal(args.paymentId, {
            amount: args.amount ? toMoney(args.amount) : undefined,
            collectionMethod: args.collectionMethod,
            occurredAt: args.occurredAt ? new Date(args.occurredAt) : undefined,
            externalReference: args.externalReference,
            reason: args.reason,
            authorization,
            idempotencyKey: args.idempotencyKey,
          });
        }),
    );
  }

  registerTransitionTool('canonical_payment_succeed_local', 'succeed');
  registerTransitionTool('canonical_payment_void_local', 'void');

  function registerTransitionTool(
    toolName: 'canonical_payment_succeed_local' | 'canonical_payment_void_local',
    operation: 'succeed' | 'void',
  ): void {
    if (!gate(toolName, 'money')) {
      return;
    }
    server.registerTool(
      toolName,
      {
        description:
          operation === 'void'
            ? 'Void a pending providerless payment. The stored status becomes canceled.'
            : 'Mark a pending providerless payment as succeeded.',
        inputSchema: {
          paymentId: z.string().min(1),
          ...requiredIdempotencyKeyShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = authorizeTool(toolName, args, options);
          return payable.storedPayments(tenantFrom(args, options))[operation](args.paymentId, {
            authorization,
            idempotencyKey: args.idempotencyKey,
          });
        }),
    );
  }
}
