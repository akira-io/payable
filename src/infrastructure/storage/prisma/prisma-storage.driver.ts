import type {
  AuditLogRepository,
  CanonicalPriceRepository,
  CanonicalProductRepository,
  CatalogSynchronizationRepository,
  CustomerProviderBindingRepository,
  CustomerRepository,
  InvoiceRepository,
  OutboxEventRepository,
  PaymentRepository,
  PriceProviderBindingRepository,
  PriceRepository,
  ProductProviderBindingRepository,
  ProductRepository,
  RefundRepository,
  SubscriptionItemRepository,
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
import { PrismaCanonicalPriceRepository } from './repositories/prisma-canonical-prices.repository';
import { PrismaCanonicalProductRepository } from './repositories/prisma-canonical-products.repository';
import { PrismaCatalogSynchronizationRepository } from './repositories/prisma-catalog-synchronizations.repository';
import { PrismaCustomerProviderBindingRepository } from './repositories/prisma-customer-provider-bindings.repository';
import { PrismaCustomerRepository } from './repositories/prisma-customers.repository';
import { PrismaInvoiceRepository } from './repositories/prisma-invoices.repository';
import { PrismaOutboxEventRepository } from './repositories/prisma-outbox.repository';
import { PrismaPaymentRepository } from './repositories/prisma-payments.repository';
import { PrismaPriceProviderBindingRepository } from './repositories/prisma-price-provider-bindings.repository';
import { PrismaPriceRepository } from './repositories/prisma-prices.repository';
import { PrismaProductProviderBindingRepository } from './repositories/prisma-product-provider-bindings.repository';
import { PrismaProductRepository } from './repositories/prisma-products.repository';
import { PrismaRefundRepository } from './repositories/prisma-refunds.repository';
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
    canonicalPrices: new PrismaCanonicalPriceRepository(client, clock),
    canonicalProducts: new PrismaCanonicalProductRepository(client, clock),
    catalogSynchronizations: new PrismaCatalogSynchronizationRepository(client, clock),
    customers: new PrismaCustomerRepository(client, clock),
    customerProviderBindings: new PrismaCustomerProviderBindingRepository(client, clock),
    products: new PrismaProductRepository(client, clock),
    productProviderBindings: new PrismaProductProviderBindingRepository(client, clock),
    prices: new PrismaPriceRepository(client, clock),
    priceProviderBindings: new PrismaPriceProviderBindingRepository(client, clock),
    subscriptions: new PrismaSubscriptionRepository(client, clock),
    subscriptionItems: new PrismaSubscriptionItemRepository(client, clock),
    invoices: new PrismaInvoiceRepository(client, clock),
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
  canonicalPrices!: CanonicalPriceRepository;
  canonicalProducts!: CanonicalProductRepository;
  catalogSynchronizations!: CatalogSynchronizationRepository;
  customers!: CustomerRepository;
  customerProviderBindings!: CustomerProviderBindingRepository;
  products!: ProductRepository;
  productProviderBindings!: ProductProviderBindingRepository;
  prices!: PriceRepository;
  priceProviderBindings!: PriceProviderBindingRepository;
  subscriptions!: SubscriptionRepository;
  subscriptionItems!: SubscriptionItemRepository;
  invoices!: InvoiceRepository;
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
    this.canonicalPrices = repositories.canonicalPrices as CanonicalPriceRepository;
    this.canonicalProducts = repositories.canonicalProducts as CanonicalProductRepository;
    this.catalogSynchronizations =
      repositories.catalogSynchronizations as CatalogSynchronizationRepository;
    this.customers = repositories.customers;
    this.customerProviderBindings = repositories.customerProviderBindings;
    this.products = repositories.products;
    this.productProviderBindings =
      repositories.productProviderBindings as ProductProviderBindingRepository;
    this.prices = repositories.prices;
    this.priceProviderBindings =
      repositories.priceProviderBindings as PriceProviderBindingRepository;
    this.subscriptions = repositories.subscriptions;
    this.subscriptionItems = repositories.subscriptionItems;
    this.invoices = repositories.invoices;
    this.payments = repositories.payments;
    this.refunds = repositories.refunds;
    this.webhookEvents = repositories.webhookEvents;
    this.webhookEndpoints = repositories.webhookEndpoints;
    this.webhookDeliveries = repositories.webhookDeliveries;
    this.auditLogs = repositories.auditLogs;
    this.outboxEvents = repositories.outboxEvents;
  }
}
