import type Stripe from 'stripe';
import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { BillingPortalDTO } from '../../../domain/dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type { ChargeResultDTO } from '../../../domain/dtos/charge.dto';
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
import type { InvoiceDTO, InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import type { CreatePriceInput, PriceDTO } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { toCheckoutSessionDTO, toCustomerDTO, toPriceDTO, toProductDTO } from './stripe-mappers';

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  private client?: Stripe;

  constructor(
    private readonly options: StripeProviderOptions,
    client?: Stripe,
  ) {
    this.client = client;
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

  createSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('createSubscription (Phase 9)');
  }

  updateSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('updateSubscription (Phase 9)');
  }

  cancelSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('cancelSubscription (Phase 9)');
  }

  resumeSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('resumeSubscription (Phase 9)');
  }

  charge(): Promise<ChargeResultDTO> {
    return this.unsupported('charge (Phase 10)');
  }

  refund(): Promise<RefundResultDTO> {
    return this.unsupported('refund (Phase 10)');
  }

  verifyWebhook(): Promise<VerifiedWebhook> {
    return this.unsupported('verifyWebhook (Phase 6)');
  }

  billingPortal(): Promise<BillingPortalDTO> {
    return this.unsupported('billingPortal (Phase 12)');
  }

  listInvoices(): Promise<InvoiceDTO[]> {
    return this.unsupported('listInvoices (Phase 10)');
  }

  downloadInvoicePdf(): Promise<InvoicePdfDTO> {
    return this.unsupported('downloadInvoicePdf (Phase 10)');
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey);
    return this.client;
  }

  private unsupported(operation: string): Promise<never> {
    return Promise.reject(PayableError.notImplemented(`StripeProvider.${operation}`));
  }
}
