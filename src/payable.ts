import {
  ReconcileRedirectPaymentAction,
  type ReconcileRedirectPaymentResult,
  type RedirectCallbackInput,
} from './application/actions/checkout/reconcile-redirect-payment.action';
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
import { CustomerContext } from './application/builders/customer-context';
import { CustomerResource } from './application/builders/customer-resource';
import { DependencyFactory } from './application/builders/dependency-factory';
import { InvoiceResource } from './application/builders/invoice-resource';
import { PriceResource } from './application/builders/price-resource';
import { ProductResource } from './application/builders/product-resource';
import { RefundResource } from './application/builders/refund-resource';
import { WebhookEndpointResource } from './application/builders/webhook-endpoint-resource';
import { WebhookEventResource } from './application/builders/webhook-event-resource';
import type { AuthorizationContext } from './application/policies/authorization-context';
import type { ReplayWebhookContext } from './application/policies/can-replay-webhook.policy';
import { ListAuditLogsQuery } from './application/queries/audit/list-audit-logs.query';
import { ListAllPaymentsQuery } from './application/queries/payments/list-all-payments.query';
import { ListAllSubscriptionsQuery } from './application/queries/subscriptions/list-all-subscriptions.query';
import {
  DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS,
  type HostResolver,
  WebhookDeliveryService,
} from './application/services/webhook-delivery/webhook-delivery-service';
import type { Clock } from './domain/contracts/clock.contract';
import type { EventBus } from './domain/contracts/event-bus.contract';
import type { ListOptions } from './domain/contracts/list-options.contract';
import type { Logger } from './domain/contracts/logger.contract';
import type { QueueJob } from './domain/contracts/queue-driver.contract';
import type { Payment } from './domain/entities/payment.entity';
import type { Refund } from './domain/entities/refund.entity';
import type { Subscription } from './domain/entities/subscription.entity';
import { PayableError } from './domain/errors/payable-error';
import type { Money } from './domain/value-objects/money';
import {
  type OutboxPublishResult,
  OutboxService,
  type OutboxServiceOptions,
} from './infrastructure/outbox/outbox-service';
import { IssuingProviderRegistry } from './issuing-provider-registry';
import { MarketplaceProviderRegistry } from './marketplace-provider-registry';
import { ProviderRegistry } from './provider-registry';
import type { ResolvedConfig } from './support/config/payable-config';
import { TaxProviderRegistry } from './tax-provider-registry';
import { TerminalProviderRegistry } from './terminal-provider-registry';
import { TreasuryProviderRegistry } from './treasury-provider-registry';

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

export class Payable {
  private readonly registry: ProviderRegistry;
  private readonly issuingRegistry: IssuingProviderRegistry;
  private readonly marketplaceRegistry: MarketplaceProviderRegistry;
  private readonly taxRegistry: TaxProviderRegistry;
  private readonly terminalRegistry: TerminalProviderRegistry;
  private readonly treasuryRegistry: TreasuryProviderRegistry;
  private readonly factory: DependencyFactory;

  constructor(private readonly resolved: ResolvedConfig) {
    this.registry = new ProviderRegistry(resolved.providers);
    this.issuingRegistry = new IssuingProviderRegistry(resolved.issuingProviders);
    this.marketplaceRegistry = new MarketplaceProviderRegistry(resolved.marketplaceProviders);
    this.taxRegistry = new TaxProviderRegistry(resolved.taxProviders);
    this.terminalRegistry = new TerminalProviderRegistry(resolved.terminalProviders);
    this.treasuryRegistry = new TreasuryProviderRegistry(resolved.treasuryProviders);
    this.factory = new DependencyFactory(resolved, this.registry);
    this.resolved.queue.process(PROCESS_WEBHOOK_JOB, (job: QueueJob) =>
      this.processWebhookJob(job),
    );
  }

  providers(): ProviderRegistry {
    return this.registry;
  }

  issuingProviders(): IssuingProviderRegistry {
    return this.issuingRegistry;
  }

  marketplaceProviders(): MarketplaceProviderRegistry {
    return this.marketplaceRegistry;
  }

  taxProviders(): TaxProviderRegistry {
    return this.taxRegistry;
  }

  terminalProviders(): TerminalProviderRegistry {
    return this.terminalRegistry;
  }

  treasuryProviders(): TreasuryProviderRegistry {
    return this.treasuryRegistry;
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
    return new CustomerContext(billable, this.factory.billing(providerName, tenantId));
  }

  customers(providerName?: string, tenantId?: string | null): CustomerResource {
    return new CustomerResource(this.factory.billing(providerName, tenantId));
  }

  products(providerName?: string, tenantId?: string | null): ProductResource {
    return new ProductResource(this.factory.billing(providerName, tenantId));
  }

  prices(providerName?: string, tenantId?: string | null): PriceResource {
    return new PriceResource(this.factory.billing(providerName, tenantId));
  }

  refunds(providerName?: string, tenantId?: string | null): RefundResource {
    return new RefundResource(this.factory.billing(providerName, tenantId));
  }

  invoices(providerName?: string, tenantId?: string | null): InvoiceResource {
    return new InvoiceResource(this.factory.billing(providerName, tenantId));
  }

  async receiveWebhook(
    input: ReceiveWebhookInput & { provider?: string },
  ): Promise<ReceiveWebhookResult> {
    return new ReceiveWebhookAction(this.factory.webhook(input.provider)).handle(input);
  }

  async receiveRedirectCallback(
    input: RedirectCallbackInput & { provider?: string },
  ): Promise<ReconcileRedirectPaymentResult> {
    return new ReconcileRedirectPaymentAction(
      this.factory.billing(input.provider, input.tenantId),
    ).handle(input);
  }

  replayWebhook(
    webhookEventId: string,
    context?: ReplayWebhookContext,
    provider?: string,
  ): Promise<void> {
    return new ReplayWebhookAction(this.factory.webhook(provider)).handle(webhookEventId, context);
  }

  outbox(options?: OutboxServiceOptions): OutboxService {
    if (!this.resolved.storage) {
      throw new PayableError('Outbox requires a storage driver', {
        code: 'OUTBOX_STORAGE_REQUIRED',
      });
    }
    return new OutboxService(this.resolved.storage.outboxEvents, this.resolved.clock, options);
  }

  deliverPendingWebhooks(options?: DeliverWebhooksOptions): Promise<OutboxPublishResult> {
    const storage = this.resolved.storage;
    if (!storage) {
      throw new PayableError('Webhook delivery requires a storage driver', {
        code: 'WEBHOOK_DELIVERY_STORAGE_REQUIRED',
      });
    }
    const service = new WebhookDeliveryService(storage, this.resolved.clock, {
      fetch: options?.fetch,
      timeoutMs: options?.timeoutMs,
      resolveHost: options?.resolveHost,
      logger: this.resolved.logger,
    });
    const outboxOptions: OutboxServiceOptions = {
      maxAttempts: DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS,
      ...options?.outbox,
    };
    return this.outbox(outboxOptions).publishPending(
      (event) => service.handle(event),
      options?.limit,
    );
  }

  webhookEndpoints(tenantId?: string | null): WebhookEndpointResource {
    if (!this.resolved.storage) {
      throw new PayableError('Webhook endpoints require a storage driver', {
        code: 'WEBHOOK_ENDPOINT_STORAGE_REQUIRED',
      });
    }
    if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
    return new WebhookEndpointResource(this.resolved.storage, tenantId ?? null);
  }

  webhookEvents(tenantId?: string | null): WebhookEventResource {
    if (!this.resolved.storage) {
      throw new PayableError('Webhook events require a storage driver', {
        code: 'WEBHOOK_STORAGE_REQUIRED',
      });
    }
    if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
    return new WebhookEventResource(this.resolved.storage, tenantId ?? null);
  }

  subscriptions(tenantId?: string | null, options?: ListOptions): Promise<Subscription[]> {
    return new ListAllSubscriptionsQuery(this.factory.billing(undefined, tenantId)).run(options);
  }

  payments(tenantId?: string | null, options?: ListOptions): Promise<Payment[]> {
    return new ListAllPaymentsQuery(this.factory.billing(undefined, tenantId)).run(options);
  }

  auditLogs(tenantId?: string | null): ListAuditLogsQuery {
    if (!this.resolved.storage) {
      throw new PayableError('Audit logs require a storage driver', {
        code: 'AUDIT_LOG_STORAGE_REQUIRED',
      });
    }
    if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
    return new ListAuditLogsQuery(this.resolved.storage.auditLogs, tenantId ?? null);
  }

  private async processWebhookJob(job: QueueJob): Promise<void> {
    const payload = job.payload as ProcessWebhookJobPayload;
    await new ProcessWebhookAction(this.factory.webhook(payload.providerName)).handle(payload);
  }

  async refund(request: RefundRequest, tenantId?: string | null): Promise<Refund> {
    const providerName = await this.resolveRefundProvider(request.paymentId, tenantId ?? null);
    return new RefundPaymentAction(this.factory.billing(providerName, tenantId)).handle({
      paymentId: request.paymentId,
      amount: request.amount,
      reason: request.reason,
      reference: request.reference,
      authorization: request.authorization,
    });
  }

  private async resolveRefundProvider(
    paymentId: string,
    tenantId: string | null,
  ): Promise<string | undefined> {
    const storage = this.resolved.storage;
    if (!storage) {
      return undefined;
    }
    const payment = await storage.payments.findById(paymentId, tenantId);
    return payment?.provider ?? undefined;
  }
}
