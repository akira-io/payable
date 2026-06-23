import type { BillingPortalDTO, BillingPortalInput } from '../dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../dtos/charge.dto';
import type { CheckoutSessionDTO, CreateCheckoutSessionInput } from '../dtos/checkout.dto';
import type { OperationContext } from '../dtos/common.dto';
import type { CreateCustomerInput, CustomerDTO, UpdateCustomerInput } from '../dtos/customer.dto';
import type { InvoiceDTO, InvoicePdfDTO, ListInvoicesInput } from '../dtos/invoice.dto';
import type { CreatePriceInput, PriceDTO } from '../dtos/price.dto';
import type { CreateProductInput, ProductDTO, UpdateProductInput } from '../dtos/product.dto';
import type { RefundInput, RefundResultDTO } from '../dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../dtos/webhook.dto';

export interface ResumeSubscriptionInput {
  providerSubscriptionId: string;
}

export interface PaymentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO>;
  updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO>;
  createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO>;
  updateSubscription(
    input: UpdateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
  cancelSubscription(
    input: CancelSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
  resumeSubscription(
    input: ResumeSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
  refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO>;
  verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook>;
  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null;
  billingPortal(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO>;
}

export interface ChargeCapable {
  charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO>;
}

export interface DirectSubscriptionCapable {
  createSubscription(
    input: CreateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
}

export interface InvoiceCapable {
  listInvoices(input: ListInvoicesInput): Promise<InvoiceDTO[]>;
  downloadInvoicePdf(providerInvoiceId: string): Promise<InvoicePdfDTO>;
}

export function isChargeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & ChargeCapable {
  return typeof (provider as Partial<ChargeCapable>).charge === 'function';
}

export function isDirectSubscriptionCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & DirectSubscriptionCapable {
  return typeof (provider as Partial<DirectSubscriptionCapable>).createSubscription === 'function';
}

export function isInvoiceCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & InvoiceCapable {
  const candidate = provider as Partial<InvoiceCapable>;
  return (
    typeof candidate.listInvoices === 'function' &&
    typeof candidate.downloadInvoicePdf === 'function'
  );
}
