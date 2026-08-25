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
  SubscriptionMutationClaimRepository,
  SubscriptionPriceMigrationRepository,
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
import type { PrismaClient, PrismaClientLike } from './prisma-client.types';
import { PrismaAuditLogRepository } from './repositories/prisma-audit-logs.repository';
import { PrismaCanonicalInvoiceRepository } from './repositories/prisma-canonical-invoices.repository';
import { PrismaCanonicalPriceRepository } from './repositories/prisma-canonical-prices.repository';
import { PrismaCanonicalProductRepository } from './repositories/prisma-canonical-products.repository';
import { PrismaCatalogSynchronizationRepository } from './repositories/prisma-catalog-synchronizations.repository';
import { PrismaCustomerProviderBindingRepository } from './repositories/prisma-customer-provider-bindings.repository';
import { PrismaCustomerProviderSyncStateRepository } from './repositories/prisma-customer-provider-sync-states.repository';
import { PrismaCustomerRepository } from './repositories/prisma-customers.repository';
import { PrismaInvoicePaymentRepository } from './repositories/prisma-invoice-payments.repository';
import { PrismaInvoiceProviderBindingRepository } from './repositories/prisma-invoice-provider-bindings.repository';
import { PrismaInvoiceRepository } from './repositories/prisma-invoices.repository';
import { PrismaOutboxEventRepository } from './repositories/prisma-outbox.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payments.repository';
import { PrismaPriceProviderBindingRepository } from './repositories/prisma-price-provider-bindings.repository';
import { PrismaPriceRepository } from './repositories/prisma-prices.repository';
import { PrismaProductProviderBindingRepository } from './repositories/prisma-product-provider-bindings.repository';
import { PrismaProductRepository } from './repositories/prisma-products.repository';
import { PrismaRefundRepository } from './repositories/prisma-refunds.repository';
import { PrismaSubscriptionMutationClaimRepository } from './repositories/prisma-subscription-mutation-claims.repository';
import { PrismaSubscriptionPriceMigrationRepository } from './repositories/prisma-subscription-price-migrations.repository';
import { PrismaSubscriptionProviderBindingRepository } from './repositories/prisma-subscription-provider-bindings.repository';
import { PrismaSubscriptionRepository } from './repositories/prisma-subscriptions.repository';
import { PrismaSubscriptionItemRepository } from './repositories/prisma-subscriptions-items.repository';
import { PrismaWebhookDeliveryRepository } from './repositories/prisma-webhook-deliveries.repository';
import { PrismaWebhookEndpointRepository } from './repositories/prisma-webhook-endpoints.repository';
import { PrismaWebhookEventRepository } from './repositories/prisma-webhook-events.repository';

function buildRepositories(
  client: PrismaClient,
  clock: Clock,
  encryption?: Encryption,
  auditKey?: string,
): Repositories {
  return {
    canonicalInvoices: new PrismaCanonicalInvoiceRepository(client, clock),
    canonicalPrices: new PrismaCanonicalPriceRepository(client, clock),
    canonicalProducts: new PrismaCanonicalProductRepository(client, clock),
    catalogSynchronizations: new PrismaCatalogSynchronizationRepository(client, clock),
    customers: new PrismaCustomerRepository(client, clock),
    customerProviderBindings: new PrismaCustomerProviderBindingRepository(client, clock),
    customerProviderSyncStates: new PrismaCustomerProviderSyncStateRepository(client, clock),
    products: new PrismaProductRepository(client, clock),
    productProviderBindings: new PrismaProductProviderBindingRepository(client, clock),
    prices: new PrismaPriceRepository(client, clock),
    priceProviderBindings: new PrismaPriceProviderBindingRepository(client, clock),
    subscriptions: new PrismaSubscriptionRepository(client, clock),
    subscriptionMutationClaims: new PrismaSubscriptionMutationClaimRepository(client),
    subscriptionPriceMigrations: new PrismaSubscriptionPriceMigrationRepository(client, clock),
    subscriptionProviderBindings: new PrismaSubscriptionProviderBindingRepository(client, clock),
    subscriptionItems: new PrismaSubscriptionItemRepository(client, clock),
    invoices: new PrismaInvoiceRepository(client, clock),
    invoicePayments: new PrismaInvoicePaymentRepository(client),
    invoiceProviderBindings: new PrismaInvoiceProviderBindingRepository(client, clock),
    payments: new PrismaPaymentRepository(client, clock),
    refunds: new PrismaRefundRepository(client, clock),
    webhookEvents: new PrismaWebhookEventRepository(client, clock, encryption),
    webhookEndpoints: new PrismaWebhookEndpointRepository(client, clock, encryption),
    webhookDeliveries: new PrismaWebhookDeliveryRepository(client, clock, encryption),
    auditLogs: new PrismaAuditLogRepository(client, clock, auditKey),
    outboxEvents: new PrismaOutboxEventRepository(client, clock, encryption),
  };
}

export class PrismaStorageDriver implements StorageDriver {
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
  subscriptionMutationClaims!: SubscriptionMutationClaimRepository;
  subscriptionPriceMigrations!: SubscriptionPriceMigrationRepository;
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
    private readonly prisma: PrismaClientLike,
    private readonly clock: Clock = new SystemClock(),
    private encryption?: Encryption,
    private readonly auditKey?: string,
  ) {
    this.assignRepositories(buildRepositories(prisma, clock, encryption, auditKey));
  }

  attachEncryption(encryption: Encryption): void {
    if (this.encryption) {
      return;
    }
    this.encryption = encryption;
    this.assignRepositories(
      buildRepositories(this.prisma, this.clock, this.encryption, this.auditKey),
    );
  }

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      work(buildRepositories(tx, this.clock, this.encryption, this.auditKey)),
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
    this.subscriptionMutationClaims = repositories.subscriptionMutationClaims;
    this.subscriptionPriceMigrations = repositories.subscriptionPriceMigrations;
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
