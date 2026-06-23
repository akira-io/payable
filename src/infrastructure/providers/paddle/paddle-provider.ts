import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { BillingPortalDTO, BillingPortalInput } from '../../../domain/dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type { ChargeResultDTO } from '../../../domain/dtos/charge.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../../domain/dtos/customer.dto';
import type { InvoiceDTO, InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import type { CreatePriceInput, PriceDTO } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { PaddleEventNormalizer } from './paddle-event-normalizer';
import {
  toCheckoutSessionDTO,
  toCustomerDTO,
  toPriceDTO,
  toProductDTO,
  toRefundResultDTO,
  toSubscriptionDTO,
} from './paddle-mappers';
import type { PaddleClient, PaddleSubscriptionEntity } from './paddle-types';
import { PaddleWebhookVerifier } from './paddle-webhook-verifier';

export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
}

export class PaddleProvider implements PaymentProvider {
  readonly name = 'paddle';
  private readonly normalizer = new PaddleEventNormalizer();
  private readonly verifier: PaddleWebhookVerifier;

  constructor(
    private readonly options: PaddleProviderOptions,
    private client?: PaddleClient,
  ) {
    this.verifier = new PaddleWebhookVerifier(options.webhookSecret);
  }

  capabilities(): ProviderCapabilities {
    return {
      checkout: true,
      subscriptions: true,
      trials: true,
      refunds: true,
      coupons: true,
      billingPortal: true,
      meteredBilling: false,
      invoicePdf: false,
    };
  }

  async createCustomer(input: CreateCustomerInput): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await paddle.customers.create({ email: input.email, name: input.name });
    return toCustomerDTO(customer);
  }

  async updateCustomer(input: UpdateCustomerInput): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await paddle.customers.update(input.providerCustomerId, {
      email: input.email,
      name: input.name,
    });
    return toCustomerDTO(customer);
  }

  async createProduct(input: CreateProductInput): Promise<ProductDTO> {
    const paddle = await this.paddle();
    const product = await paddle.products.create({
      name: input.name,
      taxCategory: 'standard',
      description: input.description,
    });
    return toProductDTO(product);
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductDTO> {
    const paddle = await this.paddle();
    const product = await paddle.products.update(input.providerProductId, {
      name: input.name,
      description: input.description,
    });
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput): Promise<PriceDTO> {
    const paddle = await this.paddle();
    const price = await paddle.prices.create({
      productId: input.providerProductId,
      description: input.providerProductId,
      unitPrice: {
        amount: String(input.unitAmount.amount()),
        currencyCode: input.unitAmount.currency(),
      },
      billingCycle: input.interval
        ? { interval: input.interval, frequency: input.intervalCount ?? 1 }
        : undefined,
    });
    return toPriceDTO(price);
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionDTO> {
    const paddle = await this.paddle();
    const transaction = await paddle.transactions.create({
      items: input.lineItems.map((item) => ({ priceId: item.priceId, quantity: item.quantity })),
      customerId: input.providerCustomerId,
    });
    return toCheckoutSessionDTO(transaction);
  }

  createSubscription(): Promise<SubscriptionDTO> {
    return Promise.reject(
      new ProviderCapabilityNotSupportedError('paddle', 'direct subscription creation'),
    );
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const items = input.priceId
      ? [{ priceId: input.priceId, quantity: input.quantity ?? 1 }]
      : undefined;
    const subscription = await paddle.subscriptions.update(input.providerSubscriptionId, { items });
    return toSubscriptionDTO(subscription);
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await paddle.subscriptions.cancel(input.providerSubscriptionId, {
      effectiveFrom: input.immediately ? 'immediately' : 'next_billing_period',
    });
    return toSubscriptionDTO(subscription);
  }

  async resumeSubscription(input: { providerSubscriptionId: string }): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await paddle.subscriptions.resume(input.providerSubscriptionId, {
      effectiveFrom: 'immediately',
    });
    return toSubscriptionDTO(subscription);
  }

  charge(): Promise<ChargeResultDTO> {
    return Promise.reject(new ProviderCapabilityNotSupportedError('paddle', 'direct charge'));
  }

  async refund(input: RefundInput): Promise<RefundResultDTO> {
    const paddle = await this.paddle();
    const adjustment = await paddle.adjustments.create({
      action: 'refund',
      transactionId: input.providerPaymentId,
      reason: input.reason ?? 'requested_by_customer',
      type: 'full',
    });
    return toRefundResultDTO(adjustment);
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    const paddle = await this.paddle();
    const event = await this.verifier.verify(paddle, input.payload, input.signature);
    return {
      providerEventId: event.eventId,
      type: event.eventType,
      normalizedType: this.normalizer.normalize(event.eventType),
      data: event.data,
    };
  }

  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null {
    if (!verified.normalizedType?.startsWith('subscription.')) {
      return null;
    }
    return toSubscriptionDTO(verified.data as unknown as PaddleSubscriptionEntity);
  }

  async billingPortal(input: BillingPortalInput): Promise<BillingPortalDTO> {
    const paddle = await this.paddle();
    const session = await paddle.customerPortalSessions.create(input.providerCustomerId, []);
    return { url: session.urls.general.overview };
  }

  listInvoices(): Promise<InvoiceDTO[]> {
    return Promise.reject(new ProviderCapabilityNotSupportedError('paddle', 'listInvoices'));
  }

  downloadInvoicePdf(): Promise<InvoicePdfDTO> {
    return Promise.reject(new ProviderCapabilityNotSupportedError('paddle', 'downloadInvoicePdf'));
  }

  private async paddle(): Promise<PaddleClient> {
    if (this.client) {
      return this.client;
    }
    const { Paddle } = await import('@paddle/paddle-node-sdk');
    this.client = new Paddle(this.options.apiKey) as unknown as PaddleClient;
    return this.client;
  }
}
