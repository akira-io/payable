import type { AuditLogRepository } from './audit-log-repository.contract';
import type { CanonicalPriceRepository } from './canonical-price-repository.contract';
import type { CanonicalProductRepository } from './canonical-product-repository.contract';
import type { CatalogSynchronizationRepository } from './catalog-synchronization-repository.contract';
import type { CustomerProviderBindingRepository } from './customer-provider-binding-repository.contract';
import type { CustomerRepository } from './customer-repository.contract';
import type { Encryption } from './encryption.contract';
import type { InvoiceRepository } from './invoice-repository.contract';
import type { OutboxEventRepository } from './outbox-event-repository.contract';
import type { PaymentRepository } from './payment-repository.contract';
import type { PriceProviderBindingRepository } from './price-provider-binding-repository.contract';
import type { PriceRepository } from './price-repository.contract';
import type { ProductProviderBindingRepository } from './product-provider-binding-repository.contract';
import type { ProductRepository } from './product-repository.contract';
import type { RefundRepository } from './refund-repository.contract';
import type { SubscriptionItemRepository } from './subscription-item-repository.contract';
import type { SubscriptionRepository } from './subscription-repository.contract';
import type { WebhookDeliveryRepository } from './webhook-delivery-repository.contract';
import type { WebhookEndpointRepository } from './webhook-endpoint-repository.contract';
import type { WebhookEventRepository } from './webhook-event-repository.contract';

export interface Repositories {
  readonly canonicalPrices?: CanonicalPriceRepository;
  readonly canonicalProducts?: CanonicalProductRepository;
  readonly catalogSynchronizations?: CatalogSynchronizationRepository;
  readonly customers: CustomerRepository;
  readonly customerProviderBindings: CustomerProviderBindingRepository;
  readonly products: ProductRepository;
  readonly prices: PriceRepository;
  readonly priceProviderBindings?: PriceProviderBindingRepository;
  readonly productProviderBindings?: ProductProviderBindingRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly subscriptionItems: SubscriptionItemRepository;
  readonly invoices: InvoiceRepository;
  readonly payments: PaymentRepository;
  readonly refunds: RefundRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly webhookEndpoints: WebhookEndpointRepository;
  readonly webhookDeliveries: WebhookDeliveryRepository;
  readonly auditLogs: AuditLogRepository;
  readonly outboxEvents: OutboxEventRepository;
}

export interface StorageDriver extends Repositories {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
  attachEncryption?(encryption: Encryption): void;
}
