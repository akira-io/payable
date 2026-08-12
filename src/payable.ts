import { registerCatalogSyncProcessor } from './application/actions/catalog-sync/register-catalog-sync-processor';
import {
  ReconcileRedirectPaymentAction,
  type ReconcileRedirectPaymentResult,
  type RedirectCallbackInput,
} from './application/actions/checkout/reconcile-redirect-payment.action';
import { RefundPaymentAction } from './application/actions/refunds/refund-payment.action';
import {
  PROCESS_TREASURY_WEBHOOK_JOB,
  ProcessTreasuryWebhookAction,
  type ProcessTreasuryWebhookJobPayload,
} from './application/actions/treasury-webhooks/process-treasury-webhook.action';
import {
  ReceiveTreasuryWebhookAction,
  type ReceiveTreasuryWebhookInput,
} from './application/actions/treasury-webhooks/receive-treasury-webhook.action';
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
import { AuditResource } from './application/builders/audit-resource';
import type { Billable } from './application/builders/billable';
import { CanonicalInvoiceResource } from './application/builders/canonical-invoice-resource';
import { CanonicalPriceResource } from './application/builders/canonical-price-resource';
import { CanonicalProductResource } from './application/builders/canonical-product-resource';
import { CanonicalSubscriptionResource } from './application/builders/canonical-subscription-resource';
import { CatalogSynchronizationResource } from './application/builders/catalog-synchronization-resource';
import { CustomerContext } from './application/builders/customer-context';
import type { CustomerResource } from './application/builders/customer-resource';
import { DependencyFactory } from './application/builders/dependency-factory';
import { InvoiceResource } from './application/builders/invoice-resource';
import type { LocalSubscriptionResource } from './application/builders/local-subscription-resource';
import { ProviderCatalogResource } from './application/builders/provider-catalog-resource';
import { RefundResource } from './application/builders/refund-resource';
import { StoredPaymentResource } from './application/builders/stored-payment-resource';
import { WebhookEndpointResource } from './application/builders/webhook-endpoint-resource';
import { WebhookEventResource } from './application/builders/webhook-event-resource';
import type { ReplayWebhookContext } from './application/policies/can-replay-webhook.policy';
import { ListAuditLogsQuery } from './application/queries/audit/list-audit-logs.query';
import { ListAllPaymentsQuery } from './application/queries/payments/list-all-payments.query';
import { ListAllSubscriptionsQuery } from './application/queries/subscriptions/list-all-subscriptions.query';
import {
  DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS,
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
import {
  type OutboxPublishResult,
  OutboxService,
  type OutboxServiceOptions,
} from './infrastructure/outbox/outbox-service';
import type { DeliverWebhooksOptions, RefundRequest } from './payable.types';
import { ProviderRegistries } from './provider-registries';
import type { ResolvedConfig } from './support/config/payable-config';

export type { DeliverWebhooksOptions, RefundRequest } from './payable.types';
export class Payable extends ProviderRegistries {
  private readonly factory: DependencyFactory;
  constructor(private readonly resolved: ResolvedConfig) {
    super(resolved);
    this.factory = new DependencyFactory(resolved, this.registry, this.treasuryRegistry);
    this.resolved.queue.process(PROCESS_WEBHOOK_JOB, (job: QueueJob) =>
      this.processWebhookJob(job),
    );
    this.resolved.queue.process(PROCESS_TREASURY_WEBHOOK_JOB, (job: QueueJob) =>
      this.processTreasuryWebhookJob(job),
    );
    registerCatalogSyncProcessor(this.resolved.queue, this.factory);
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
    return this.factory.customerResource(providerName, tenantId);
  }
  products(tenantId?: string | null): CanonicalProductResource {
    return new CanonicalProductResource(this.factory.local(tenantId));
  }
  catalogSync(providerName: string, tenantId?: string | null): CatalogSynchronizationResource {
    return new CatalogSynchronizationResource(
      this.factory.billing(providerName, tenantId),
      this.resolved.queue,
    );
  }
  providerCatalog(providerName?: string, tenantId?: string | null): ProviderCatalogResource {
    return new ProviderCatalogResource(this.factory.billing(providerName, tenantId));
  }
  prices(tenantId?: string | null): CanonicalPriceResource {
    return new CanonicalPriceResource(this.factory.local(tenantId));
  }
  canonicalSubscriptions(tenantId?: string | null): CanonicalSubscriptionResource {
    return new CanonicalSubscriptionResource(this.factory.local(tenantId));
  }
  canonicalInvoices(tenantId?: string | null): CanonicalInvoiceResource {
    return new CanonicalInvoiceResource(this.factory.local(tenantId));
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

  receiveTreasuryWebhook(
    input: ReceiveTreasuryWebhookInput & { provider?: string },
  ): Promise<ReceiveWebhookResult> {
    return new ReceiveTreasuryWebhookAction(this.factory.treasuryWebhook(input.provider)).handle(
      input,
    );
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
    return new ListAllSubscriptionsQuery(this.factory.local(tenantId)).run(options);
  }
  subscription(
    localId: string,
    tenantId?: string | null,
    providerName?: string,
  ): LocalSubscriptionResource {
    return this.factory.localSubscription(localId, tenantId, providerName);
  }

  payments(tenantId?: string | null, options?: ListOptions): Promise<Payment[]> {
    return new ListAllPaymentsQuery(this.factory.local(tenantId)).run(options);
  }
  storedPayments(tenantId?: string | null): StoredPaymentResource {
    return new StoredPaymentResource(this.factory.local(tenantId));
  }
  audit(tenantId?: string | null): AuditResource {
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
    return new AuditResource(this.resolved.storage.auditLogs, tenantId ?? null);
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

  private async processTreasuryWebhookJob(job: QueueJob): Promise<void> {
    const payload = job.payload as ProcessTreasuryWebhookJobPayload;
    await new ProcessTreasuryWebhookAction(
      this.factory.treasuryWebhook(payload.providerName),
    ).handle(payload);
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
