import { RefundPaymentAction } from './application/actions/refunds/refund-payment.action';
import {
  PROCESS_WEBHOOK_JOB,
  ProcessWebhookAction,
  type ProcessWebhookJobPayload,
} from './application/actions/webhooks/process-webhook.action';
import {
  ReceiveWebhookAction,
  type ReceiveWebhookInput,
  type ReceiveWebhookResult,
} from './application/actions/webhooks/receive-webhook.action';
import { ReplayWebhookAction } from './application/actions/webhooks/replay-webhook.action';
import type { Billable } from './application/builders/billable';
import type { BillingDependencies } from './application/builders/billing-dependencies';
import { CustomerContext } from './application/builders/customer-context';
import type { WebhookDependencies } from './application/builders/webhook-dependencies';
import type { AuthorizationContext } from './application/policies/authorization-context';
import type { ReplayWebhookContext } from './application/policies/can-replay-webhook.policy';
import type { Clock } from './domain/contracts/clock.contract';
import type { EventBus } from './domain/contracts/event-bus.contract';
import type { Logger } from './domain/contracts/logger.contract';
import type { PaymentProvider } from './domain/contracts/payment-provider.contract';
import type { QueueJob } from './domain/contracts/queue-driver.contract';
import type { Refund } from './domain/entities/refund.entity';
import { PayableError } from './domain/errors/payable-error';
import { ProviderNotFoundError } from './domain/errors/provider-not-found.error';
import type { Money } from './domain/value-objects/money';
import { OutboxService, type OutboxServiceOptions } from './infrastructure/outbox/outbox-service';
import type { ResolvedConfig } from './support/config/payable-config';

export interface RefundRequest {
  paymentId: string;
  amount?: Money;
  reason?: string;
  authorization?: AuthorizationContext;
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
    this.resolved.queue.process(PROCESS_WEBHOOK_JOB, (job: QueueJob) =>
      this.processWebhookJob(job),
    );
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

  customer(billable: Billable, providerName?: string, tenantId?: string | null): CustomerContext {
    return new CustomerContext(billable, this.dependencies(providerName, tenantId));
  }

  async receiveWebhook(
    input: ReceiveWebhookInput & { provider?: string },
  ): Promise<ReceiveWebhookResult> {
    return new ReceiveWebhookAction(this.webhookDependencies(input.provider)).handle(input);
  }

  replayWebhook(
    webhookEventId: string,
    context?: ReplayWebhookContext,
    provider?: string,
  ): Promise<void> {
    return new ReplayWebhookAction(this.webhookDependencies(provider)).handle(
      webhookEventId,
      context,
    );
  }

  outbox(options?: OutboxServiceOptions): OutboxService {
    if (!this.resolved.storage) {
      throw new PayableError('Outbox requires a storage driver', {
        code: 'OUTBOX_STORAGE_REQUIRED',
      });
    }
    return new OutboxService(this.resolved.storage.outboxEvents, this.resolved.clock, options);
  }

  private dependencies(providerName?: string, tenantId?: string | null): BillingDependencies {
    const name = providerName ?? this.registry.names()[0];
    if (!name) {
      throw new ProviderNotFoundError(providerName ?? 'default');
    }
    if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
    return {
      provider: this.registry.get(name),
      providerName: name,
      clock: this.resolved.clock,
      storage: this.resolved.storage,
      tenantId: tenantId ?? null,
      authorizationEnabled: this.resolved.authorizationEnabled,
    };
  }

  private async processWebhookJob(job: QueueJob): Promise<void> {
    const payload = job.payload as ProcessWebhookJobPayload;
    await new ProcessWebhookAction(this.webhookDependencies(payload.providerName)).handle(payload);
  }

  private webhookDependencies(providerName?: string): WebhookDependencies {
    const name = providerName ?? this.defaultWebhookProvider();
    if (!this.resolved.storage) {
      throw new PayableError('Webhook processing requires a storage driver', {
        code: 'WEBHOOK_STORAGE_REQUIRED',
      });
    }
    return {
      provider: this.registry.get(name),
      providerName: name,
      storage: this.resolved.storage,
      queue: this.resolved.queue,
      events: this.resolved.events,
      clock: this.resolved.clock,
      tenantResolver: this.resolved.tenantResolver,
    };
  }

  private defaultWebhookProvider(): string {
    const names = this.registry.names();
    if (names.length > 1) {
      throw new PayableError(
        'Multiple providers are registered; route the webhook to /webhooks/:provider',
        { code: 'WEBHOOK_PROVIDER_AMBIGUOUS' },
      );
    }
    const name = names[0];
    if (!name) {
      throw new ProviderNotFoundError('default');
    }
    return name;
  }

  refund(request: RefundRequest): Promise<Refund> {
    return new RefundPaymentAction(this.dependencies()).handle({
      paymentId: request.paymentId,
      amount: request.amount,
      reason: request.reason,
      authorization: request.authorization,
    });
  }
}
