import type { AuthorizationContext } from './application/policies/authorization-context';
import type { HostResolver } from './application/services/webhook-delivery/webhook-delivery-service';
import type { Money } from './domain/value-objects/money';
import type { OutboxServiceOptions } from './infrastructure/outbox/outbox-service';

export interface RefundRequest {
  paymentId: string;
  amount?: Money;
  reason?: string;
  reference?: string;
  authorization?: AuthorizationContext;
}

export interface DeliverWebhooksOptions {
  limit?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  resolveHost?: HostResolver;
  outbox?: OutboxServiceOptions;
}
