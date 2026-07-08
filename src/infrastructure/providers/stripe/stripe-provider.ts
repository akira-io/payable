import type Stripe from 'stripe';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  ChargeCapable,
  DirectSubscriptionCapable,
  InvoiceCapable,
  PaymentProvider,
  PaymentWebhookCapable,
  PaymentWebhookReconciliation,
  ResumeSubscriptionInput,
} from '../../../domain/contracts/payment-provider.contract';
import type { BillingPortalDTO, BillingPortalInput } from '../../../domain/dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../../../domain/dtos/charge.dto';
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
import type {
  InvoiceDTO,
  InvoicePdfDTO,
  ListInvoicesInput,
} from '../../../domain/dtos/invoice.dto';
import type { CreatePriceInput, PriceDTO } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { assertSubscriptionPayload } from '../webhook-subscription-payload';
import { stripeAmount } from './stripe-amounts';
import { StripeCatalog } from './stripe-catalog';
import { withStripeErrors } from './stripe-errors';
import { StripeEventNormalizer } from './stripe-event-normalizer';
import { StripeInvoices } from './stripe-invoices';
import {
  toChargeResultDTO,
  toCheckoutSessionDTO,
  toCustomerDTO,
  toRefundResultDTO,
  toSubscriptionDTOFromWebhook,
} from './stripe-mappers';
import { reconcileStripePaymentWebhook } from './stripe-payment-webhook-reconciliation';
import { StripeSubscriptions } from './stripe-subscriptions';
import { StripeWebhookVerifier } from './stripe-webhook-verifier';

export const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

function stripeRefundReason(reason?: string): Stripe.RefundCreateParams.Reason | undefined {
  return reason && STRIPE_REFUND_REASONS.has(reason)
    ? (reason as Stripe.RefundCreateParams.Reason)
    : undefined;
}

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  logger?: Logger;
}

export class StripeProvider
  implements
    PaymentProvider,
    ChargeCapable,
    DirectSubscriptionCapable,
    InvoiceCapable,
    PaymentWebhookCapable
{
  readonly name = 'stripe';
  private client?: Stripe;
  private readonly verifier: StripeWebhookVerifier;
  private readonly normalizer: StripeEventNormalizer;
  private readonly subscriptions = new StripeSubscriptions(() => this.stripe());
  private readonly invoices = new StripeInvoices(() => this.stripe());
  private readonly catalog = new StripeCatalog(() => this.stripe());

  constructor(
    private readonly options: StripeProviderOptions,
    client?: Stripe,
  ) {
    this.normalizer = new StripeEventNormalizer(options.logger);
    this.client = client;
    this.verifier = new StripeWebhookVerifier(options.webhookSecret);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set([
      'checkout',
      'charges',
      'subscriptions',
      'trials',
      'refunds',
      'coupons',
      'billingPortal',
      'invoicePdf',
      'webhooks',
      'customers',
      'catalog',
    ]);
  }

  async createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.stripe();
    const customer = await withStripeErrors(() =>
      stripe.customers.create(
        { email: input.email, name: input.name, metadata: input.metadata },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toCustomerDTO(customer);
  }

  async updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.stripe();
    const customer = await withStripeErrors(() =>
      stripe.customers.update(
        input.providerCustomerId,
        { email: input.email, name: input.name, metadata: input.metadata },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toCustomerDTO(customer);
  }

  async createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    return this.catalog.createProduct(input, ctx);
  }

  async updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    return this.catalog.updateProduct(input, ctx);
  }

  async createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    return this.catalog.createPrice(input, ctx);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const stripe = await this.stripe();
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: input.providerCustomerId,
      mode: input.mode,
      line_items: input.lineItems.map((item) => ({ price: item.priceId, quantity: item.quantity })),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.reference,
    };
    if (input.mode === 'subscription' && input.trialDays !== undefined) {
      params.subscription_data = { trial_period_days: input.trialDays };
    }
    if (input.coupon) {
      params.discounts = [{ coupon: input.coupon }];
    }
    const session = await withStripeErrors(() =>
      stripe.checkout.sessions.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toCheckoutSessionDTO(session);
  }

  createSubscription(
    input: CreateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.create(input, ctx);
  }

  updateSubscription(
    input: UpdateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.update(input, ctx);
  }

  cancelSubscription(
    input: CancelSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.cancel(input, ctx);
  }

  resumeSubscription(
    input: ResumeSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.resume(input, ctx);
  }

  async charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
    const stripe = await this.stripe();
    const intent = await withStripeErrors(() =>
      stripe.paymentIntents.create(
        {
          amount: stripeAmount(input.amount),
          currency: input.amount.currency().toLowerCase(),
          customer: input.providerCustomerId,
          description: input.description,
          metadata: input.reference ? { reference: input.reference } : undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toChargeResultDTO(intent);
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    const stripe = await this.stripe();
    const refund = await withStripeErrors(() =>
      stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amount ? stripeAmount(input.amount) : undefined,
          reason: stripeRefundReason(input.reason),
          metadata: input.reference ? { reference: input.reference } : undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toRefundResultDTO(refund);
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    const stripe = await this.stripe();
    const event = await this.verifier.verify(stripe, input.payload, input.signature);
    return {
      providerEventId: event.id,
      type: event.type,
      normalizedType: this.normalizer.normalize(event.type),
      data: (event.data.object ?? {}) as unknown as Record<string, unknown>,
    };
  }

  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null {
    if (!verified.normalizedType?.startsWith('subscription.')) {
      return null;
    }
    assertSubscriptionPayload(verified.data, 'stripe');
    return toSubscriptionDTOFromWebhook(verified.data);
  }

  reconcilePayment(verified: VerifiedWebhook): PaymentWebhookReconciliation | null {
    return reconcileStripePaymentWebhook(verified);
  }

  async billingPortal(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO> {
    const stripe = await this.stripe();
    const session = await withStripeErrors(() =>
      stripe.billingPortal.sessions.create(
        { customer: input.providerCustomerId, return_url: input.returnUrl },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return { url: session.url };
  }

  async listInvoices(input: ListInvoicesInput): Promise<InvoiceDTO[]> {
    return this.invoices.list(input);
  }

  async downloadInvoicePdf(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    return this.invoices.downloadPdf(providerInvoiceId);
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, {
      apiVersion: STRIPE_API_VERSION,
    });
    return this.client;
  }
}
