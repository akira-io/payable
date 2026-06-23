import type Stripe from 'stripe';
import type {
  ChargeCapable,
  DirectSubscriptionCapable,
  InvoiceCapable,
  PaymentProvider,
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
import { PayableError } from '../../../domain/errors/payable-error';
import { StripeEventNormalizer } from './stripe-event-normalizer';
import {
  toChargeResultDTO,
  toCheckoutSessionDTO,
  toCustomerDTO,
  toInvoiceDTO,
  toPriceDTO,
  toProductDTO,
  toRefundResultDTO,
  toSubscriptionDTO,
} from './stripe-mappers';
import { StripeSubscriptions } from './stripe-subscriptions';
import { StripeWebhookVerifier } from './stripe-webhook-verifier';

export const STRIPE_API_VERSION = '2026-05-27.dahlia' as const;

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
}

export class StripeProvider
  implements PaymentProvider, ChargeCapable, DirectSubscriptionCapable, InvoiceCapable
{
  readonly name = 'stripe';
  private client?: Stripe;
  private readonly verifier: StripeWebhookVerifier;
  private readonly normalizer = new StripeEventNormalizer();
  private readonly subscriptions = new StripeSubscriptions(() => this.stripe());

  constructor(
    private readonly options: StripeProviderOptions,
    client?: Stripe,
  ) {
    this.client = client;
    this.verifier = new StripeWebhookVerifier(options.webhookSecret);
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
      invoicePdf: true,
    };
  }

  async createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.stripe();
    const customer = await stripe.customers.create(
      { email: input.email, name: input.name, metadata: input.metadata },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toCustomerDTO(customer);
  }

  async updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.stripe();
    const customer = await stripe.customers.update(
      input.providerCustomerId,
      { email: input.email, name: input.name, metadata: input.metadata },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toCustomerDTO(customer);
  }

  async createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const stripe = await this.stripe();
    const product = await stripe.products.create(
      {
        name: input.name,
        description: input.description,
        active: input.active,
        metadata: input.metadata,
      },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toProductDTO(product);
  }

  async updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const stripe = await this.stripe();
    const product = await stripe.products.update(
      input.providerProductId,
      { name: input.name, description: input.description, active: input.active },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    const stripe = await this.stripe();
    const params: Stripe.PriceCreateParams = {
      product: input.providerProductId,
      currency: input.unitAmount.currency().toLowerCase(),
      unit_amount: input.unitAmount.amount(),
    };
    if (input.interval) {
      params.recurring = { interval: input.interval, interval_count: input.intervalCount ?? 1 };
    }
    const price = await stripe.prices.create(params, { idempotencyKey: ctx.idempotencyKey });
    return toPriceDTO(price);
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
    };
    if (input.mode === 'subscription' && input.trialDays !== undefined) {
      params.subscription_data = { trial_period_days: input.trialDays };
    }
    if (input.coupon) {
      params.discounts = [{ coupon: input.coupon }];
    }
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: ctx.idempotencyKey,
    });
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
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amount.amount(),
        currency: input.amount.currency().toLowerCase(),
        customer: input.providerCustomerId,
        description: input.description,
        metadata: input.reference ? { reference: input.reference } : undefined,
      },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toChargeResultDTO(intent);
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    const stripe = await this.stripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amount?.amount(),
        reason: input.reason as Stripe.RefundCreateParams.Reason | undefined,
      },
      { idempotencyKey: ctx.idempotencyKey },
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
    return toSubscriptionDTO(verified.data as unknown as Stripe.Subscription);
  }

  async billingPortal(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO> {
    const stripe = await this.stripe();
    const session = await stripe.billingPortal.sessions.create(
      { customer: input.providerCustomerId, return_url: input.returnUrl },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return { url: session.url };
  }

  async listInvoices(input: ListInvoicesInput): Promise<InvoiceDTO[]> {
    const stripe = await this.stripe();
    const cap = input.limit ?? 1000;
    const invoices = await stripe.invoices
      .list({ customer: input.providerCustomerId, limit: Math.min(cap, 100) })
      .autoPagingToArray({ limit: cap });
    return invoices.map(toInvoiceDTO);
  }

  async downloadInvoicePdf(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    const stripe = await this.stripe();
    const invoice = await stripe.invoices.retrieve(providerInvoiceId);
    if (!invoice.invoice_pdf) {
      throw new PayableError(`Invoice ${providerInvoiceId} has no PDF`, {
        code: 'INVOICE_PDF_UNAVAILABLE',
      });
    }
    const response = await globalThis.fetch(invoice.invoice_pdf);
    if (!response.ok) {
      throw new PayableError(`Failed to download invoice ${providerInvoiceId} PDF`, {
        code: 'INVOICE_PDF_DOWNLOAD_FAILED',
        context: { status: response.status },
      });
    }
    const content = new Uint8Array(await response.arrayBuffer());
    return { filename: `${providerInvoiceId}.pdf`, content };
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
