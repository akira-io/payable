import type Stripe from 'stripe';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  ChargeCapable,
  DirectSubscriptionCapable,
  DisputeCapable,
  InvoiceCapable,
  PaymentMethodCapable,
  PaymentMethodSetupCapable,
  PaymentProvider,
  PaymentWebhookCapable,
  PaymentWebhookReconciliation,
  PayoutCapable,
  ProviderWebhookEndpointManagementCapable,
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
import type { DisputeDTO, ListDisputesInput } from '../../../domain/dtos/dispute.dto';
import type {
  InvoiceDTO,
  InvoicePdfDTO,
  ListInvoicesInput,
} from '../../../domain/dtos/invoice.dto';
import type {
  DeletePaymentMethodInput,
  ListPaymentMethodsInput,
  PaymentMethodDTO,
} from '../../../domain/dtos/payment-method.dto';
import type { ListPayoutsInput, PayoutDTO } from '../../../domain/dtos/payout.dto';
import type { CreatePriceInput, PriceDTO } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import type {
  CreateProviderWebhookEndpointInput,
  ListProviderWebhookEndpointsInput,
  ProviderWebhookEndpointDTO,
  UpdateProviderWebhookEndpointInput,
} from '../../../domain/dtos/provider-webhook-endpoint.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { StripeBillingPortal } from './stripe-billing-portal';
import { StripeCatalog } from './stripe-catalog';
import { StripeCheckout } from './stripe-checkout';
import { StripeCustomers } from './stripe-customers';
import { StripeDisputes } from './stripe-disputes';
import { StripeInvoices } from './stripe-invoices';
import { StripePaymentMethodSetup } from './stripe-payment-method-setup';
import { StripePaymentMethods } from './stripe-payment-methods';
import { StripePayments } from './stripe-payments';
import { StripePayouts } from './stripe-payouts';
import { StripeSubscriptions } from './stripe-subscriptions';
import { StripeWebhookEndpoints } from './stripe-webhook-endpoints';
import { StripeWebhooks } from './stripe-webhooks';

export { STRIPE_API_VERSION } from './stripe-api-version';

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
    DisputeCapable,
    InvoiceCapable,
    PaymentMethodCapable,
    PaymentMethodSetupCapable,
    PaymentWebhookCapable,
    PayoutCapable,
    ProviderWebhookEndpointManagementCapable
{
  readonly name = 'stripe';
  private client?: Stripe;
  private readonly webhooks: StripeWebhooks;
  private readonly subscriptions = new StripeSubscriptions(() => this.stripe());
  private readonly invoices = new StripeInvoices(() => this.stripe());
  private readonly catalog = new StripeCatalog(() => this.stripe());
  private readonly customers = new StripeCustomers(() => this.stripe());
  private readonly paymentMethods = new StripePaymentMethods(() => this.stripe());
  private readonly paymentMethodSetup = new StripePaymentMethodSetup(() => this.stripe());
  readonly createPaymentMethodSetup = this.paymentMethodSetup.create.bind(this.paymentMethodSetup);
  readonly retrievePaymentMethodSetup = this.paymentMethodSetup.retrieve.bind(
    this.paymentMethodSetup,
  );
  readonly cancelPaymentMethodSetup = this.paymentMethodSetup.cancel.bind(this.paymentMethodSetup);
  private readonly billingPortalSessions = new StripeBillingPortal(() => this.stripe());
  private readonly payments = new StripePayments(() => this.stripe());
  private readonly disputes = new StripeDisputes(() => this.stripe());
  private readonly payouts = new StripePayouts(() => this.stripe());
  private readonly checkout = new StripeCheckout(() => this.stripe());
  private readonly webhookEndpoints = new StripeWebhookEndpoints(() => this.stripe());

  constructor(
    private readonly options: StripeProviderOptions,
    client?: unknown,
  ) {
    this.client = client as Stripe | undefined;
    this.webhooks = new StripeWebhooks(() => this.stripe(), options.webhookSecret, options.logger);
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
      'paymentMethods',
      'paymentMethodSetup',
      'disputes',
      'payouts',
      'webhookEndpointManagement',
      'catalog',
    ]);
  }

  createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.create(input, ctx);
  }
  updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.update(input, ctx);
  }
  listPaymentMethods(input: ListPaymentMethodsInput): Promise<PaymentMethodDTO[]> {
    return this.paymentMethods.list(input);
  }
  deletePaymentMethod(input: DeletePaymentMethodInput, ctx: OperationContext): Promise<void> {
    return this.paymentMethods.delete(input, ctx);
  }
  listDisputes(input?: ListDisputesInput): Promise<DisputeDTO[]> {
    return this.disputes.list(input);
  }
  retrieveDispute(providerDisputeId: string): Promise<DisputeDTO> {
    return this.disputes.retrieve(providerDisputeId);
  }
  acceptDispute(providerDisputeId: string, ctx: OperationContext): Promise<void> {
    return this.disputes.accept(providerDisputeId, ctx);
  }
  listPayouts(input?: ListPayoutsInput): Promise<PayoutDTO[]> {
    return this.payouts.list(input);
  }
  retrievePayout(providerPayoutId: string): Promise<PayoutDTO> {
    return this.payouts.retrieve(providerPayoutId);
  }

  createWebhookEndpoint(
    input: CreateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    return this.webhookEndpoints.create(input, ctx);
  }

  listWebhookEndpoints(
    input?: ListProviderWebhookEndpointsInput,
  ): Promise<ProviderWebhookEndpointDTO[]> {
    return this.webhookEndpoints.list(input);
  }

  retrieveWebhookEndpoint(providerWebhookEndpointId: string): Promise<ProviderWebhookEndpointDTO> {
    return this.webhookEndpoints.retrieve(providerWebhookEndpointId);
  }

  updateWebhookEndpoint(
    input: UpdateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    return this.webhookEndpoints.update(input, ctx);
  }

  deleteWebhookEndpoint(providerWebhookEndpointId: string, ctx: OperationContext): Promise<void> {
    return this.webhookEndpoints.delete(providerWebhookEndpointId, ctx);
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
    return this.checkout.create(input, ctx);
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

  charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
    return this.payments.charge(input, ctx);
  }

  refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    return this.payments.refund(input, ctx);
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    return this.webhooks.verify(input);
  }

  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null {
    return this.webhooks.reconcileSubscription(verified);
  }

  reconcilePayment(verified: VerifiedWebhook): PaymentWebhookReconciliation | null {
    return this.webhooks.reconcilePayment(verified);
  }

  billingPortal(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO> {
    return this.billingPortalSessions.create(input, ctx);
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
