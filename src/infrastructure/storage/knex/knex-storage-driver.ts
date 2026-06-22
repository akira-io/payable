import type { Knex } from 'knex';
import type {
  AuditLogRepository,
  CustomerRepository,
  InvoiceRepository,
  OutboxEventRepository,
  PaymentRepository,
  PriceRepository,
  ProductRepository,
  RefundRepository,
  SubscriptionItemRepository,
  SubscriptionRepository,
  WebhookEventRepository,
} from '../../../domain/contracts';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  Repositories,
  StorageDriver,
} from '../../../domain/contracts/storage-driver.contract';
import { SystemClock } from '../../../support/clock/system-clock';
import { KnexAuditLogRepository } from './repositories/knex-audit-log.repository';
import { KnexCustomerRepository } from './repositories/knex-customer.repository';
import { KnexInvoiceRepository } from './repositories/knex-invoice.repository';
import { KnexOutboxEventRepository } from './repositories/knex-outbox-event.repository';
import { KnexPaymentRepository } from './repositories/knex-payment.repository';
import { KnexPriceRepository } from './repositories/knex-price.repository';
import { KnexProductRepository } from './repositories/knex-product.repository';
import { KnexRefundRepository } from './repositories/knex-refund.repository';
import { KnexSubscriptionRepository } from './repositories/knex-subscription.repository';
import { KnexSubscriptionItemRepository } from './repositories/knex-subscription-item.repository';
import { KnexWebhookEventRepository } from './repositories/knex-webhook-event.repository';

function buildRepositories(qb: Knex, clock: Clock): Repositories {
  return {
    customers: new KnexCustomerRepository(qb, clock),
    products: new KnexProductRepository(qb, clock),
    prices: new KnexPriceRepository(qb, clock),
    subscriptions: new KnexSubscriptionRepository(qb, clock),
    subscriptionItems: new KnexSubscriptionItemRepository(qb, clock),
    invoices: new KnexInvoiceRepository(qb, clock),
    payments: new KnexPaymentRepository(qb, clock),
    refunds: new KnexRefundRepository(qb, clock),
    webhookEvents: new KnexWebhookEventRepository(qb),
    auditLogs: new KnexAuditLogRepository(qb, clock),
    outboxEvents: new KnexOutboxEventRepository(qb, clock),
  };
}

export class KnexStorageDriver implements StorageDriver {
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
  readonly prices: PriceRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly subscriptionItems: SubscriptionItemRepository;
  readonly invoices: InvoiceRepository;
  readonly payments: PaymentRepository;
  readonly refunds: RefundRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly auditLogs: AuditLogRepository;
  readonly outboxEvents: OutboxEventRepository;

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock = new SystemClock(),
  ) {
    const repositories = buildRepositories(knex, clock);
    this.customers = repositories.customers;
    this.products = repositories.products;
    this.prices = repositories.prices;
    this.subscriptions = repositories.subscriptions;
    this.subscriptionItems = repositories.subscriptionItems;
    this.invoices = repositories.invoices;
    this.payments = repositories.payments;
    this.refunds = repositories.refunds;
    this.webhookEvents = repositories.webhookEvents;
    this.auditLogs = repositories.auditLogs;
    this.outboxEvents = repositories.outboxEvents;
  }

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.knex.transaction((trx) => work(buildRepositories(trx, this.clock)));
  }
}
