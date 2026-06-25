import type { Logger } from '../../../domain/contracts/logger.contract';
import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { BillingPortalDTO, BillingPortalInput } from '../../../domain/dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../../domain/dtos/customer.dto';
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
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { assertSubscriptionPayload } from '../webhook-subscription-payload';
import { buildPaddleClientOptions } from './paddle-client-options';
import { withPaddleErrors } from './paddle-errors';
import { PaddleEventNormalizer } from './paddle-event-normalizer';
import {
  toCheckoutSessionDTO,
  toCustomerDTO,
  toPaddleSubscriptionEntity,
  toPriceDTO,
  toProductDTO,
  toRefundResultDTO,
  toSubscriptionDTO,
} from './paddle-mappers';
import type { PaddleClient } from './paddle-types';
import { PaddleWebhookVerifier } from './paddle-webhook-verifier';

export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
  environment?: 'sandbox' | 'production';
  logger?: Logger;
}

export class PaddleProvider implements PaymentProvider {
  readonly name = 'paddle';
  private readonly normalizer: PaddleEventNormalizer;
  private readonly verifier: PaddleWebhookVerifier;
  private readonly injected: boolean;

  constructor(
    private readonly options: PaddleProviderOptions,
    private client?: PaddleClient,
  ) {
    this.injected = client !== undefined;
    this.normalizer = new PaddleEventNormalizer(options.logger);
    this.verifier = new PaddleWebhookVerifier(options.webhookSecret);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `PaddleProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set([
      'checkout',
      'subscriptions',
      'refunds',
      'billingPortal',
      'customers',
      'catalog',
    ]);
  }

  async createCustomer(input: CreateCustomerInput): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await withPaddleErrors(() =>
      paddle.customers.create({ email: input.email, name: input.name }),
    );
    return toCustomerDTO(customer);
  }

  async updateCustomer(input: UpdateCustomerInput): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await withPaddleErrors(() =>
      paddle.customers.update(input.providerCustomerId, {
        email: input.email,
        name: input.name,
      }),
    );
    return toCustomerDTO(customer);
  }

  async createProduct(input: CreateProductInput): Promise<ProductDTO> {
    const paddle = await this.paddle();
    const product = await withPaddleErrors(() =>
      paddle.products.create({
        name: input.name,
        taxCategory: 'standard',
        description: input.description,
      }),
    );
    return toProductDTO(product);
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductDTO> {
    const paddle = await this.paddle();
    const product = await withPaddleErrors(() =>
      paddle.products.update(input.providerProductId, {
        name: input.name,
        description: input.description,
      }),
    );
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput): Promise<PriceDTO> {
    const paddle = await this.paddle();
    const price = await withPaddleErrors(() =>
      paddle.prices.create({
        productId: input.providerProductId,
        description:
          input.description ?? (input.interval ? `${input.interval} price` : 'One-time price'),
        unitPrice: {
          amount: String(input.unitAmount.amount()),
          currencyCode: input.unitAmount.currency(),
        },
        billingCycle: input.interval
          ? { interval: input.interval, frequency: input.intervalCount ?? 1 }
          : undefined,
      }),
    );
    return toPriceDTO(price);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const paddle = await this.paddle(ctx.idempotencyKey);
    const transaction = await withPaddleErrors(() =>
      paddle.transactions.create({
        items: input.lineItems.map((item) => ({ priceId: item.priceId, quantity: item.quantity })),
        customerId: input.providerCustomerId,
      }),
    );
    return toCheckoutSessionDTO(transaction);
  }

  async updateSubscription(input: UpdateSubscriptionInput): Promise<SubscriptionDTO> {
    if (!input.priceId) {
      throw new PayableError(
        `Paddle subscription ${input.providerSubscriptionId} update requires a price id`,
        {
          code: 'PROVIDER_SUBSCRIPTION_ITEM_MISSING',
          context: { providerSubscriptionId: input.providerSubscriptionId },
        },
      );
    }
    const paddle = await this.paddle();
    const items = [{ priceId: input.priceId, quantity: input.quantity ?? 1 }];
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.update(input.providerSubscriptionId, {
        items,
        prorationBillingMode: 'prorated_immediately',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.cancel(input.providerSubscriptionId, {
        effectiveFrom: input.immediately ? 'immediately' : 'next_billing_period',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async resumeSubscription(input: { providerSubscriptionId: string }): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.resume(input.providerSubscriptionId, {
        effectiveFrom: 'immediately',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    if (input.amount) {
      throw new ProviderCapabilityNotSupportedError('paddle', 'partial refund');
    }
    const paddle = await this.paddle(ctx.idempotencyKey);
    const adjustment = await withPaddleErrors(() =>
      paddle.adjustments.create({
        action: 'refund',
        transactionId: input.providerPaymentId,
        reason: input.reason ?? 'requested_by_customer',
        type: 'full',
      }),
    );
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
    assertSubscriptionPayload(verified.data, 'paddle');
    return toSubscriptionDTO(toPaddleSubscriptionEntity(verified.data));
  }

  async billingPortal(input: BillingPortalInput): Promise<BillingPortalDTO> {
    const paddle = await this.paddle();
    const session = await withPaddleErrors(() =>
      paddle.customerPortalSessions.create(input.providerCustomerId, []),
    );
    return { url: session.urls.general.overview };
  }

  private async paddle(idempotencyKey?: string): Promise<PaddleClient> {
    if (this.injected && this.client) {
      return this.client;
    }
    if (!idempotencyKey && this.client) {
      return this.client;
    }
    const { Paddle, Environment } = await import('@paddle/paddle-node-sdk');
    const options = buildPaddleClientOptions(this.options.environment, idempotencyKey);
    const client = new Paddle(this.options.apiKey, {
      environment: options.environment === 'sandbox' ? Environment.sandbox : Environment.production,
      customHeaders: options.customHeaders,
    }) as unknown as PaddleClient;
    if (!idempotencyKey) {
      this.client = client;
    }
    return client;
  }
}
