import type {
  AuditLogRepository,
  CustomerRepository,
  InvoiceRepository,
  OutboxEventRepository,
  PaymentRepository,
  PriceRepository,
  ProductRepository,
  RefundRepository,
  SubscriptionRepository,
  WebhookEventRepository,
} from '../../../domain/contracts';
import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { KnexAuditLogRepository } from './repositories/knex-audit-log.repository';
import { KnexCustomerRepository } from './repositories/knex-customer.repository';
import { KnexInvoiceRepository } from './repositories/knex-invoice.repository';
import { KnexOutboxEventRepository } from './repositories/knex-outbox-event.repository';
import { KnexPaymentRepository } from './repositories/knex-payment.repository';
import { KnexPriceRepository } from './repositories/knex-price.repository';
import { KnexProductRepository } from './repositories/knex-product.repository';
import { KnexRefundRepository } from './repositories/knex-refund.repository';
import { KnexSubscriptionRepository } from './repositories/knex-subscription.repository';
import { KnexWebhookEventRepository } from './repositories/knex-webhook-event.repository';

// TODO: Phase 3
export class KnexStorageDriver implements StorageDriver {
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
  readonly prices: PriceRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly payments: PaymentRepository;
  readonly refunds: RefundRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly auditLogs: AuditLogRepository;
  readonly outboxEvents: OutboxEventRepository;

  constructor(connection: unknown) {
    this.customers = new KnexCustomerRepository(connection);
    this.products = new KnexProductRepository(connection);
    this.prices = new KnexPriceRepository(connection);
    this.subscriptions = new KnexSubscriptionRepository(connection);
    this.invoices = new KnexInvoiceRepository(connection);
    this.payments = new KnexPaymentRepository(connection);
    this.refunds = new KnexRefundRepository(connection);
    this.webhookEvents = new KnexWebhookEventRepository(connection);
    this.auditLogs = new KnexAuditLogRepository(connection);
    this.outboxEvents = new KnexOutboxEventRepository(connection);
  }

  transaction<T>(): Promise<T> {
    throw PayableError.notImplemented('KnexStorageDriver.transaction (Phase 3)');
  }
}
