import type { BillingPortalDTO, BillingPortalInput } from '../dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../dtos/charge.dto';
import type { CheckoutSessionDTO, CreateCheckoutSessionInput } from '../dtos/checkout.dto';
import type { OperationContext } from '../dtos/common.dto';
import type { CreateCustomerInput, CustomerDTO, UpdateCustomerInput } from '../dtos/customer.dto';
import type { DisputeDTO, ListDisputesInput } from '../dtos/dispute.dto';
import type { InvoiceDTO, InvoicePdfDTO, ListInvoicesInput } from '../dtos/invoice.dto';
import type {
  DeletePaymentMethodInput,
  ListPaymentMethodsInput,
  PaymentMethodDTO,
} from '../dtos/payment-method.dto';
import type {
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupDTO,
} from '../dtos/payment-method-setup.dto';
import type { ListPayoutsInput, PayoutDTO } from '../dtos/payout.dto';
import type { CreatePriceInput, PriceDTO } from '../dtos/price.dto';
import type { CreateProductInput, ProductDTO, UpdateProductInput } from '../dtos/product.dto';
import type {
  CreateProviderWebhookEndpointInput,
  ListProviderWebhookEndpointsInput,
  ProviderWebhookEndpointDTO,
  UpdateProviderWebhookEndpointInput,
} from '../dtos/provider-webhook-endpoint.dto';
import type { RefundInput, RefundResultDTO } from '../dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../dtos/webhook.dto';
import type { PaymentStatus } from '../value-objects/payment-status';

export interface ResumeSubscriptionInput {
  providerSubscriptionId: string;
}

export interface PaymentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO>;
  refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO>;
}

export interface CustomerCapable {
  createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO>;
  updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO>;
}

export interface CatalogCapable {
  createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
}

export interface SubscriptionManagementCapable {
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
}

export interface WebhookCapable {
  verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook>;
  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null;
}

export interface BillingPortalCapable {
  billingPortal(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO>;
}

export interface RedirectCallbackResult {
  providerPaymentId: string;
  status: PaymentStatus;
}

export interface PaymentWebhookReconciliation {
  providerPaymentId: string;
  status: PaymentStatus;
}

export interface PaymentWebhookCapable {
  reconcilePayment(verified: VerifiedWebhook): PaymentWebhookReconciliation | null;
}

export interface RedirectCallbackCapable {
  verifyCallback(payload: Record<string, unknown>): boolean | Promise<boolean>;
  handleRedirectCallback(payload: Record<string, unknown>): Promise<RedirectCallbackResult>;
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

export interface PaymentMethodCapable {
  listPaymentMethods(input: ListPaymentMethodsInput): Promise<PaymentMethodDTO[]>;
  deletePaymentMethod(input: DeletePaymentMethodInput, ctx: OperationContext): Promise<void>;
}
export interface PaymentMethodSetupCapable {
  createPaymentMethodSetup(
    input: CreatePaymentMethodSetupInput,
    ctx: OperationContext,
  ): Promise<PaymentMethodSetupDTO>;
  retrievePaymentMethodSetup(providerSetupId: string): Promise<PaymentMethodSetupDTO>;
  cancelPaymentMethodSetup(
    providerSetupId: string,
    ctx: OperationContext,
  ): Promise<PaymentMethodSetupDTO>;
}

export interface DisputeCapable {
  listDisputes(input?: ListDisputesInput): Promise<DisputeDTO[]>;
  retrieveDispute(providerDisputeId: string): Promise<DisputeDTO>;
  acceptDispute(providerDisputeId: string, ctx: OperationContext): Promise<void>;
}

export interface PayoutCapable {
  listPayouts(input?: ListPayoutsInput): Promise<PayoutDTO[]>;
  retrievePayout(providerPayoutId: string): Promise<PayoutDTO>;
}

export interface ProviderWebhookEndpointManagementCapable {
  createWebhookEndpoint(
    input: CreateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO>;
  listWebhookEndpoints(
    input?: ListProviderWebhookEndpointsInput,
  ): Promise<ProviderWebhookEndpointDTO[]>;
  retrieveWebhookEndpoint(providerWebhookEndpointId: string): Promise<ProviderWebhookEndpointDTO>;
  updateWebhookEndpoint(
    input: UpdateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO>;
  deleteWebhookEndpoint(providerWebhookEndpointId: string, ctx: OperationContext): Promise<void>;
}

export function isCustomerCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CustomerCapable {
  const candidate = provider as Partial<CustomerCapable>;
  return (
    typeof candidate.createCustomer === 'function' && typeof candidate.updateCustomer === 'function'
  );
}

export function isCatalogCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CatalogCapable {
  const candidate = provider as Partial<CatalogCapable>;
  return (
    typeof candidate.createProduct === 'function' &&
    typeof candidate.updateProduct === 'function' &&
    typeof candidate.createPrice === 'function'
  );
}

export function isSubscriptionManagementCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionManagementCapable {
  const candidate = provider as Partial<SubscriptionManagementCapable>;
  return (
    typeof candidate.updateSubscription === 'function' &&
    typeof candidate.cancelSubscription === 'function' &&
    typeof candidate.resumeSubscription === 'function'
  );
}

export function isWebhookCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & WebhookCapable {
  const candidate = provider as Partial<WebhookCapable>;
  return (
    typeof candidate.verifyWebhook === 'function' &&
    typeof candidate.reconcileSubscription === 'function'
  );
}

export function isBillingPortalCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & BillingPortalCapable {
  return typeof (provider as Partial<BillingPortalCapable>).billingPortal === 'function';
}

export function isRedirectCallbackCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & RedirectCallbackCapable {
  const candidate = provider as Partial<RedirectCallbackCapable>;
  return (
    typeof candidate.verifyCallback === 'function' &&
    typeof candidate.handleRedirectCallback === 'function'
  );
}

export function isPaymentWebhookCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PaymentWebhookCapable {
  return typeof (provider as Partial<PaymentWebhookCapable>).reconcilePayment === 'function';
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

export function isPaymentMethodCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PaymentMethodCapable {
  const candidate = provider as Partial<PaymentMethodCapable>;
  return (
    typeof candidate.listPaymentMethods === 'function' &&
    typeof candidate.deletePaymentMethod === 'function'
  );
}
export function isPaymentMethodSetupCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PaymentMethodSetupCapable {
  const candidate = provider as Partial<PaymentMethodSetupCapable>;
  return (
    typeof candidate.createPaymentMethodSetup === 'function' &&
    typeof candidate.retrievePaymentMethodSetup === 'function' &&
    typeof candidate.cancelPaymentMethodSetup === 'function'
  );
}

export function isDisputeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & DisputeCapable {
  const candidate = provider as Partial<DisputeCapable>;
  return (
    typeof candidate.listDisputes === 'function' &&
    typeof candidate.retrieveDispute === 'function' &&
    typeof candidate.acceptDispute === 'function'
  );
}

export function isPayoutCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PayoutCapable {
  const candidate = provider as Partial<PayoutCapable>;
  return (
    typeof candidate.listPayouts === 'function' && typeof candidate.retrievePayout === 'function'
  );
}

export function isProviderWebhookEndpointManagementCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & ProviderWebhookEndpointManagementCapable {
  const candidate = provider as Partial<ProviderWebhookEndpointManagementCapable>;
  return (
    typeof candidate.createWebhookEndpoint === 'function' &&
    typeof candidate.listWebhookEndpoints === 'function' &&
    typeof candidate.retrieveWebhookEndpoint === 'function' &&
    typeof candidate.updateWebhookEndpoint === 'function' &&
    typeof candidate.deleteWebhookEndpoint === 'function'
  );
}
