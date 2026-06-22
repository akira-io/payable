import {
  ReceiveWebhookAction,
  type ReceiveWebhookInput,
  type ReceiveWebhookResult,
} from './application/actions/webhooks/receive-webhook.action';
import type { Billable } from './application/builders/billable';
import type { BillingDependencies } from './application/builders/billing-dependencies';
import { CustomerContext } from './application/builders/customer-context';
import type { WebhookDependencies } from './application/builders/webhook-dependencies';
import type { Clock } from './domain/contracts/clock.contract';
import type { EventBus } from './domain/contracts/event-bus.contract';
import type { Logger } from './domain/contracts/logger.contract';
import type { PaymentProvider } from './domain/contracts/payment-provider.contract';
import type { RefundResultDTO } from './domain/dtos/refund.dto';
import { PayableError } from './domain/errors/payable-error';
import { ProviderNotFoundError } from './domain/errors/provider-not-found.error';
import type { Money } from './domain/value-objects/money';
import type { ResolvedConfig } from './support/config/payable-config';

export interface RefundRequest {
  paymentId: string;
  amount?: Money;
  reason?: string;
}

export class ProviderRegistry {
  constructor(private readonly providers: Map<string, PaymentProvider>) {}

  register(name: string, provider: PaymentProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderNotFoundError(name);
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}

export class Payable {
  private readonly registry: ProviderRegistry;

  constructor(private readonly resolved: ResolvedConfig) {
    this.registry = new ProviderRegistry(resolved.providers);
  }

  providers(): ProviderRegistry {
    return this.registry;
  }

  events(): EventBus {
    return this.resolved.events;
  }

  clock(): Clock {
    return this.resolved.clock;
  }

  logger(): Logger {
    return this.resolved.logger;
  }

  tenantEnabled(): boolean {
    return this.resolved.tenantEnabled;
  }

  customer(billable: Billable): CustomerContext {
    return new CustomerContext(billable, this.dependencies());
  }

  async receiveWebhook(
    input: ReceiveWebhookInput & { provider?: string },
  ): Promise<ReceiveWebhookResult> {
    return new ReceiveWebhookAction(this.webhookDependencies(input.provider)).handle(input);
  }

  private dependencies(): BillingDependencies {
    const [providerName] = this.registry.names();
    if (!providerName) {
      throw new ProviderNotFoundError('default');
    }
    return {
      provider: this.registry.get(providerName),
      providerName,
      clock: this.resolved.clock,
      storage: this.resolved.storage,
    };
  }

  private webhookDependencies(providerName?: string): WebhookDependencies {
    const name = providerName ?? this.registry.names()[0];
    if (!name) {
      throw new ProviderNotFoundError('default');
    }
    if (!this.resolved.storage) {
      throw new PayableError('Webhook processing requires a storage driver', {
        code: 'WEBHOOK_STORAGE_REQUIRED',
      });
    }
    return {
      provider: this.registry.get(name),
      providerName: name,
      storage: this.resolved.storage,
      events: this.resolved.events,
      clock: this.resolved.clock,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResultDTO> {
    throw PayableError.notImplemented(`Payable.refund (${request.paymentId})`);
  }
}
