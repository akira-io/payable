import type { Knex } from 'knex';
import type {
  AuditLogRepository,
  CanonicalInvoiceRepository,
  CanonicalPriceRepository,
  CanonicalProductRepository,
  CatalogSynchronizationRepository,
  CustomerProviderBindingRepository,
  CustomerProviderSyncStateRepository,
  CustomerRepository,
  InvoicePaymentRepository,
  InvoiceProviderBindingRepository,
  InvoiceRepository,
  OutboxEventRepository,
  PaymentRepository,
  PriceProviderBindingRepository,
  PriceRepository,
  ProductProviderBindingRepository,
  ProductRepository,
  RefundRepository,
  SubscriptionItemRepository,
  SubscriptionProviderBindingRepository,
  SubscriptionRepository,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
  WebhookEventRepository,
} from '../../../domain/contracts';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type { Encryption } from '../../../domain/contracts/encryption.contract';
import type {
  Repositories,
  StorageDriver,
} from '../../../domain/contracts/storage-driver.contract';
import { SystemClock } from '../../../support/clock/system-clock';
import { KnexAuditLogRepository } from './repositories/knex-audit-log.repository';
import { KnexCanonicalInvoiceRepository } from './repositories/knex-canonical-invoice.repository';
import { KnexCanonicalPriceRepository } from './repositories/knex-canonical-price.repository';
import { KnexCanonicalProductRepository } from './repositories/knex-canonical-product.repository';
import { KnexCatalogSynchronizationRepository } from './repositories/knex-catalog-synchronization.repository';
import { KnexCustomerRepository } from './repositories/knex-customer.repository';
import { KnexCustomerProviderBindingRepository } from './repositories/knex-customer-provider-binding.repository';
import { KnexCustomerProviderSyncStateRepository } from './repositories/knex-customer-provider-sync-state.repository';
import { KnexInvoiceRepository } from './repositories/knex-invoice.repository';
import { KnexInvoicePaymentRepository } from './repositories/knex-invoice-payment.repository';
import { KnexInvoiceProviderBindingRepository } from './repositories/knex-invoice-provider-binding.repository';
import { KnexOutboxEventRepository } from './repositories/knex-outbox-event.repository';
import { KnexPaymentRepository } from './repositories/knex-payment.repository';
import { KnexPriceRepository } from './repositories/knex-price.repository';
import { KnexPriceProviderBindingRepository } from './repositories/knex-price-provider-binding.repository';
import { KnexProductRepository } from './repositories/knex-product.repository';
import { KnexProductProviderBindingRepository } from './repositories/knex-product-provider-binding.repository';
import { KnexRefundRepository } from './repositories/knex-refund.repository';
import { KnexSubscriptionRepository } from './repositories/knex-subscription.repository';
import { KnexSubscriptionItemRepository } from './repositories/knex-subscription-item.repository';
import { KnexSubscriptionProviderBindingRepository } from './repositories/knex-subscription-provider-binding.repository';
import { KnexWebhookDeliveryRepository } from './repositories/knex-webhook-delivery.repository';
import { KnexWebhookEndpointRepository } from './repositories/knex-webhook-endpoint.repository';
import { KnexWebhookEventRepository } from './repositories/knex-webhook-event.repository';

function buildRepositories(
  qb: Knex,
  clock: Clock,
  encryption?: Encryption,
  auditKey?: string,
): Repositories {
  return {
    canonicalInvoices: new KnexCanonicalInvoiceRepository(qb, clock),
    canonicalPrices: new KnexCanonicalPriceRepository(qb, clock),
    canonicalProducts: new KnexCanonicalProductRepository(qb, clock),
    catalogSynchronizations: new KnexCatalogSynchronizationRepository(qb, clock),
    customers: new KnexCustomerRepository(qb, clock),
    customerProviderBindings: new KnexCustomerProviderBindingRepository(qb, clock),
    customerProviderSyncStates: new KnexCustomerProviderSyncStateRepository(qb, clock),
    products: new KnexProductRepository(qb, clock),
    productProviderBindings: new KnexProductProviderBindingRepository(qb, clock),
    prices: new KnexPriceRepository(qb, clock),
    priceProviderBindings: new KnexPriceProviderBindingRepository(qb, clock),
    subscriptions: new KnexSubscriptionRepository(qb, clock),
    subscriptionProviderBindings: new KnexSubscriptionProviderBindingRepository(qb, clock),
    subscriptionItems: new KnexSubscriptionItemRepository(qb, clock),
    invoices: new KnexInvoiceRepository(qb, clock),
    invoicePayments: new KnexInvoicePaymentRepository(qb),
    invoiceProviderBindings: new KnexInvoiceProviderBindingRepository(qb, clock),
    payments: new KnexPaymentRepository(qb, clock),
    refunds: new KnexRefundRepository(qb, clock),
    webhookEvents: new KnexWebhookEventRepository(qb, clock, encryption),
    webhookEndpoints: new KnexWebhookEndpointRepository(qb, clock, encryption),
    webhookDeliveries: new KnexWebhookDeliveryRepository(qb, clock, encryption),
    auditLogs: new KnexAuditLogRepository(qb, clock, auditKey),
    outboxEvents: new KnexOutboxEventRepository(qb, clock, encryption),
  };
}

export class KnexStorageDriver implements StorageDriver {
  canonicalInvoices!: CanonicalInvoiceRepository;
  canonicalPrices!: CanonicalPriceRepository;
  canonicalProducts!: CanonicalProductRepository;
  catalogSynchronizations!: CatalogSynchronizationRepository;
  customers!: CustomerRepository;
  customerProviderBindings!: CustomerProviderBindingRepository;
  customerProviderSyncStates!: CustomerProviderSyncStateRepository;
  products!: ProductRepository;
  productProviderBindings!: ProductProviderBindingRepository;
  prices!: PriceRepository;
  priceProviderBindings!: PriceProviderBindingRepository;
  subscriptions!: SubscriptionRepository;
  subscriptionProviderBindings!: SubscriptionProviderBindingRepository;
  subscriptionItems!: SubscriptionItemRepository;
  invoices!: InvoiceRepository;
  invoicePayments!: InvoicePaymentRepository;
  invoiceProviderBindings!: InvoiceProviderBindingRepository;
  payments!: PaymentRepository;
  refunds!: RefundRepository;
  webhookEvents!: WebhookEventRepository;
  webhookEndpoints!: WebhookEndpointRepository;
  webhookDeliveries!: WebhookDeliveryRepository;
  auditLogs!: AuditLogRepository;
  outboxEvents!: OutboxEventRepository;

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock = new SystemClock(),
    private encryption?: Encryption,
    private readonly auditKey?: string,
  ) {
    this.assignRepositories(buildRepositories(knex, clock, encryption, auditKey));
  }

  attachEncryption(encryption: Encryption): void {
    if (this.encryption) {
      return;
    }
    this.encryption = encryption;
    this.assignRepositories(
      buildRepositories(this.knex, this.clock, this.encryption, this.auditKey),
    );
  }

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.knex.transaction((trx) =>
      work(buildRepositories(trx, this.clock, this.encryption, this.auditKey)),
    );
  }

  private assignRepositories(repositories: Repositories): void {
    this.canonicalInvoices = repositories.canonicalInvoices as CanonicalInvoiceRepository;
    this.canonicalPrices = repositories.canonicalPrices as CanonicalPriceRepository;
    this.canonicalProducts = repositories.canonicalProducts as CanonicalProductRepository;
    this.catalogSynchronizations =
      repositories.catalogSynchronizations as CatalogSynchronizationRepository;
    this.customers = repositories.customers;
    this.customerProviderBindings = repositories.customerProviderBindings;
    this.customerProviderSyncStates =
      repositories.customerProviderSyncStates as CustomerProviderSyncStateRepository;
    this.products = repositories.products;
    this.productProviderBindings =
      repositories.productProviderBindings as ProductProviderBindingRepository;
    this.prices = repositories.prices;
    this.priceProviderBindings =
      repositories.priceProviderBindings as PriceProviderBindingRepository;
    this.subscriptions = repositories.subscriptions;
    this.subscriptionProviderBindings = repositories.subscriptionProviderBindings;
    this.subscriptionItems = repositories.subscriptionItems;
    this.invoices = repositories.invoices;
    this.invoicePayments = repositories.invoicePayments as InvoicePaymentRepository;
    this.invoiceProviderBindings =
      repositories.invoiceProviderBindings as InvoiceProviderBindingRepository;
    this.payments = repositories.payments;
    this.refunds = repositories.refunds;
    this.webhookEvents = repositories.webhookEvents;
    this.webhookEndpoints = repositories.webhookEndpoints;
    this.webhookDeliveries = repositories.webhookDeliveries;
    this.auditLogs = repositories.auditLogs;
    this.outboxEvents = repositories.outboxEvents;
  }
}
