import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Payable } from '../../../payable';

const ENTITIES = {
  customer: ['id', 'provider', 'billableType', 'billableId', 'email', 'name', 'tenantId'],
  subscription: ['id', 'customerId', 'name', 'status', 'priceId', 'quantity', 'currentPeriodEnd'],
  payment: ['id', 'customerId', 'status', 'amount', 'currency', 'refundedAmount'],
  invoice: ['id', 'customerId', 'subscriptionId', 'status', 'total', 'currency'],
  refund: ['id', 'paymentId', 'status', 'amount', 'currency', 'reason'],
  webhookEvent: ['id', 'provider', 'providerEventId', 'type', 'status', 'receivedAt'],
};

const STATUSES = {
  subscription: ['active', 'trialing', 'past_due', 'paused', 'canceled', 'incomplete'],
  payment: ['pending', 'succeeded', 'failed', 'requires_action'],
  invoice: ['draft', 'open', 'paid', 'void', 'uncollectible'],
  refund: ['pending', 'succeeded', 'failed'],
  webhookEvent: ['pending', 'processing', 'processed', 'failed'],
};

export function registerResources(server: McpServer, payable: Payable): void {
  server.registerResource(
    'entities',
    'payable://schema/entities',
    {
      title: 'Payable entities',
      description: 'Field names and status enums for billing entities. Amounts are minor units.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ entities: ENTITIES, statuses: STATUSES }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'providers',
    'payable://config/providers',
    {
      title: 'Configured providers',
      description: 'Payment provider names registered on this server.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ providers: payable.providers().names() }, null, 2),
        },
      ],
    }),
  );
}
