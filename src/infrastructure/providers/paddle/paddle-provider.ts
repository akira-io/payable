import type { Logger } from '../../../domain/contracts/logger.contract';
import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type {
  PausedSubscriptionResumeCapable,
  ScheduledSubscriptionChangeCapable,
  SubscriptionPauseCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import type { SubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
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
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { requireSubscriptionChangePolicies } from '../../../domain/validation/subscription-change-policies';
import { assertSubscriptionPayload } from '../webhook-subscription-payload';
import { PaddleCatalog } from './paddle-catalog';
import { buildPaddleClientOptions } from './paddle-client-options';
import { withPaddleErrors } from './paddle-errors';
import { PaddleEventNormalizer } from './paddle-event-normalizer';
import {
  toCheckoutSessionDTO,
  toCustomerDTO,
  toPaddleSubscriptionEntity,
  toRefundResultDTO,
  toSubscriptionDTO,
} from './paddle-mappers';
import { PaddleSubscriptionChanges, paddleProrationPolicy } from './paddle-subscription-changes';
import { PaddleSubscriptionLifecycle } from './paddle-subscription-lifecycle';
import { paddleSubscriptionOperationCapabilities } from './paddle-subscription-operation-capabilities';
import type { PaddleClient } from './paddle-types';
import { PaddleWebhookVerifier } from './paddle-webhook-verifier';

export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
  environment?: 'sandbox' | 'production';
  logger?: Logger;
}

export class PaddleProvider
  implements
    PaymentProvider,
    SubscriptionOperationCapabilitiesProvider,
    SubscriptionPauseCapable,
    PausedSubscriptionResumeCapable,
    ScheduledSubscriptionChangeCapable
{
  readonly name = 'paddle';
  private readonly catalog: PaddleCatalog;
  private readonly normalizer: PaddleEventNormalizer;
  private readonly verifier: PaddleWebhookVerifier;
  private readonly subscriptionChanges = new PaddleSubscriptionChanges(() => this.paddle());
  private readonly subscriptionLifecycle = new PaddleSubscriptionLifecycle(() => this.paddle());
  readonly previewSubscriptionChange = this.subscriptionChanges.preview.bind(
    this.subscriptionChanges,
  );
  readonly applySubscriptionChange = this.subscriptionChanges.apply.bind(this.subscriptionChanges);
  readonly pauseSubscription = this.subscriptionLifecycle.pause.bind(this.subscriptionLifecycle);
  readonly resumePausedSubscription = this.subscriptionLifecycle.resume.bind(
    this.subscriptionLifecycle,
  );
  readonly cancelScheduledSubscriptionChange =
    this.subscriptionLifecycle.cancelScheduledChange.bind(this.subscriptionLifecycle);
  readonly createProduct: PaddleCatalog['createProduct'];
  readonly updateProduct: PaddleCatalog['updateProduct'];
  readonly createPrice: PaddleCatalog['createPrice'];
  readonly updatePrice: PaddleCatalog['updatePrice'];
  readonly retrieveProduct: PaddleCatalog['retrieveProduct'];
  readonly listProducts: PaddleCatalog['listProducts'];
  readonly retrievePrice: PaddleCatalog['retrievePrice'];
  readonly listPrices: PaddleCatalog['listPrices'];
  readonly setProductActive: PaddleCatalog['setProductActive'];
  readonly setPriceActive: PaddleCatalog['setPriceActive'];
  constructor(
    private readonly options: PaddleProviderOptions,
    private client?: PaddleClient,
  ) {
    this.catalog = new PaddleCatalog(() => this.paddle());
    this.createProduct = this.catalog.createProduct.bind(this.catalog);
    this.updateProduct = this.catalog.updateProduct.bind(this.catalog);
    this.createPrice = this.catalog.createPrice.bind(this.catalog);
    this.updatePrice = this.catalog.updatePrice.bind(this.catalog);
    this.retrieveProduct = this.catalog.retrieveProduct.bind(this.catalog);
    this.listProducts = this.catalog.listProducts.bind(this.catalog);
    this.retrievePrice = this.catalog.retrievePrice.bind(this.catalog);
    this.listPrices = this.catalog.listPrices.bind(this.catalog);
    this.setProductActive = this.catalog.setProductActive.bind(this.catalog);
    this.setPriceActive = this.catalog.setPriceActive.bind(this.catalog);
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
      'webhooks',
      'customers',
      'catalog',
      'catalogRead',
      'catalogLifecycle',
      'catalogProductCreate',
      'catalogProductUpdate',
      'catalogProductArchive',
      'catalogProductReactivate',
      'catalogPriceCreate',
      'catalogPriceUpdate',
      'catalogPriceArchive',
      'catalogPriceReactivate',
    ]);
  }

  subscriptionOperationCapabilities() {
    return paddleSubscriptionOperationCapabilities();
  }

  async createCustomer(input: CreateCustomerInput, _ctx: OperationContext): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await withPaddleErrors(() =>
      paddle.customers.create({ email: input.email, name: input.name }),
    );
    return toCustomerDTO(customer);
  }

  async updateCustomer(input: UpdateCustomerInput, _ctx: OperationContext): Promise<CustomerDTO> {
    const paddle = await this.paddle();
    const customer = await withPaddleErrors(() =>
      paddle.customers.update(input.providerCustomerId, {
        email: input.email,
        name: input.name,
      }),
    );
    return toCustomerDTO(customer);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    _ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const paddle = await this.paddle();
    const transaction = await withPaddleErrors(() =>
      paddle.transactions.create({
        items: input.lineItems.map((item) => ({ priceId: item.priceId, quantity: item.quantity })),
        customerId: input.providerCustomerId,
      }),
    );
    return toCheckoutSessionDTO(transaction);
  }

  async updateSubscription(
    input: UpdateSubscriptionInput,
    _ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
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
    const policies = requireSubscriptionChangePolicies(input);
    if (policies.effectiveTiming !== 'immediate') {
      throw new ProviderCapabilityNotSupportedError(
        'paddle',
        `subscriptions.change.${policies.effectiveTiming}`,
      );
    }
    const items =
      input.items && input.items.length > 0
        ? input.items
        : [{ priceId: input.priceId, quantity: input.quantity ?? 1 }];
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.update(input.providerSubscriptionId, {
        items,
        prorationBillingMode: paddleProrationPolicy(policies.prorationPolicy),
        onPaymentFailure:
          policies.paymentFailurePolicy === 'preventChange' ? 'prevent_change' : 'apply_change',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async cancelSubscription(
    input: CancelSubscriptionInput,
    _ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.cancel(input.providerSubscriptionId, {
        effectiveFrom: input.immediately ? 'immediately' : 'next_billing_period',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async resumeSubscription(
    input: { providerSubscriptionId: string },
    _ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    const paddle = await this.paddle();
    const subscription = await withPaddleErrors(() =>
      paddle.subscriptions.resume(input.providerSubscriptionId, {
        effectiveFrom: 'immediately',
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async refund(input: RefundInput, _ctx: OperationContext): Promise<RefundResultDTO> {
    if (input.amount) {
      throw new ProviderCapabilityNotSupportedError('paddle', 'partial refund');
    }
    const paddle = await this.paddle();
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
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
    return {
      providerEventId: event.eventId,
      type: event.eventType,
      normalizedType: this.normalizer.normalize(event.eventType),
      occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
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

  async billingPortal(
    input: BillingPortalInput,
    _ctx: OperationContext,
  ): Promise<BillingPortalDTO> {
    const paddle = await this.paddle();
    const session = await withPaddleErrors(() =>
      paddle.customerPortalSessions.create(input.providerCustomerId, []),
    );
    return { url: session.urls.general.overview };
  }

  private async paddle(): Promise<PaddleClient> {
    if (this.client) {
      return this.client;
    }
    const { Paddle, Environment } = await import('@paddle/paddle-node-sdk');
    const options = buildPaddleClientOptions(this.options.environment);
    const client = new Paddle(this.options.apiKey, {
      environment: options.environment === 'sandbox' ? Environment.sandbox : Environment.production,
    }) as unknown as PaddleClient;
    this.client = client;
    return client;
  }
}
