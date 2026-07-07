import type {
  PaymentProvider,
  PaymentWebhookReconciliation,
} from '../../src/domain/contracts/payment-provider.contract';
import type {
  BillingPortalDTO,
  BillingPortalInput,
} from '../../src/domain/dtos/billing-portal.dto';
import type {
  ProviderCapabilities,
  ProviderCapabilityValue,
} from '../../src/domain/dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../../src/domain/dtos/charge.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../src/domain/dtos/checkout.dto';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../src/domain/dtos/customer.dto';
import type {
  InvoiceDTO,
  InvoicePdfDTO,
  ListInvoicesInput,
} from '../../src/domain/dtos/invoice.dto';
import type { CreatePriceInput, PriceDTO } from '../../src/domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../src/domain/dtos/product.dto';
import type { RefundInput, RefundResultDTO } from '../../src/domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../src/domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../src/domain/dtos/webhook.dto';
import { Money } from '../../src/domain/value-objects/money';

const PERIOD_END = new Date('2026-07-22T00:00:00.000Z');
const TRIAL_END = new Date('2026-07-06T00:00:00.000Z');

export class FakeProvider implements PaymentProvider {
  readonly name = 'stripe';
  createCustomerCalls = 0;
  lastCustomerCtx?: OperationContext;
  lastUpdateCustomer?: UpdateCustomerInput;
  lastCheckout?: { input: CreateCheckoutSessionInput; ctx: OperationContext };
  verifyResult?: VerifiedWebhook;
  verifyError?: Error;
  reconcileResult?: SubscriptionDTO | null;
  paymentReconcileResult?: PaymentWebhookReconciliation | null;
  lastVerifyInput?: WebhookVerificationInput;
  createdSubscriptions = 0;
  lastSubscriptionUpdate?: UpdateSubscriptionInput;
  lastSubscriptionUpdateCtx?: OperationContext;
  lastCreateSubscription?: CreateSubscriptionInput;
  lastCreateProduct?: CreateProductInput;
  lastUpdateProduct?: UpdateProductInput;
  lastCreatePrice?: CreatePriceInput;
  lastChargeCtx?: OperationContext;
  lastRefundInput?: RefundInput;
  lastRefundCtx?: OperationContext;
  chargeCalls = 0;
  refundCalls = 0;
  readonly supportedCapabilities = new Set<ProviderCapabilityValue>([
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

  capabilities(): ProviderCapabilities {
    return new Set(this.supportedCapabilities);
  }

  async createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    this.createCustomerCalls += 1;
    this.lastCustomerCtx = ctx;
    return { providerCustomerId: 'cus_fake', email: input.email, name: input.name ?? null };
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    this.lastCheckout = { input, ctx };
    return { id: 'cs_fake', url: 'https://fake.test/cs' };
  }

  async updateCustomer(input: UpdateCustomerInput): Promise<CustomerDTO> {
    this.lastUpdateCustomer = input;
    return {
      providerCustomerId: input.providerCustomerId,
      email: input.email ?? null,
      name: input.name ?? null,
    };
  }

  async createProduct(input: CreateProductInput): Promise<ProductDTO> {
    this.lastCreateProduct = input;
    return { providerProductId: 'prod_fake', name: input.name, active: input.active ?? true };
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductDTO> {
    this.lastUpdateProduct = input;
    return {
      providerProductId: input.providerProductId,
      name: input.name ?? 'Product',
      active: input.active ?? true,
    };
  }

  async createPrice(input: CreatePriceInput): Promise<PriceDTO> {
    this.lastCreatePrice = input;
    return {
      providerPriceId: 'price_fake',
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
    };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionDTO> {
    this.createdSubscriptions += 1;
    this.lastCreateSubscription = input;
    return {
      providerSubscriptionId: 'sub_fake',
      status: input.trialDays !== undefined ? 'trialing' : 'active',
      currentPeriodEnd: PERIOD_END,
      trialEndsAt: input.trialDays !== undefined ? TRIAL_END : null,
    };
  }

  async updateSubscription(
    input: UpdateSubscriptionInput,
    ctx?: OperationContext,
  ): Promise<SubscriptionDTO> {
    this.lastSubscriptionUpdate = input;
    this.lastSubscriptionUpdateCtx = ctx;
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      trialEndsAt: null,
    };
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: input.immediately ? 'canceled' : 'active',
      currentPeriodEnd: PERIOD_END,
      trialEndsAt: null,
    };
  }

  async resumeSubscription(input: { providerSubscriptionId: string }): Promise<SubscriptionDTO> {
    return {
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'active',
      currentPeriodEnd: PERIOD_END,
      trialEndsAt: null,
    };
  }

  async charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
    this.lastChargeCtx = ctx;
    this.chargeCalls += 1;
    return {
      providerPaymentId: `pi_fake_${this.chargeCalls}`,
      status: 'succeeded',
      amount: input.amount,
    };
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    this.lastRefundInput = input;
    this.lastRefundCtx = ctx;
    this.refundCalls += 1;
    return {
      providerRefundId: `re_fake_${this.refundCalls}`,
      status: 'succeeded',
      amount: input.amount ?? Money.of(0, 'USD'),
    };
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    this.lastVerifyInput = input;
    if (this.verifyError) {
      throw this.verifyError;
    }
    if (!this.verifyResult) {
      return this.unused('verifyWebhook');
    }
    return this.verifyResult;
  }

  reconcileSubscription(): SubscriptionDTO | null {
    return this.reconcileResult ?? null;
  }

  reconcilePayment(): PaymentWebhookReconciliation | null {
    return this.paymentReconcileResult ?? null;
  }

  async billingPortal(input: BillingPortalInput): Promise<BillingPortalDTO> {
    return { url: `https://portal.fake/${input.providerCustomerId}` };
  }

  async listInvoices(_input: ListInvoicesInput): Promise<InvoiceDTO[]> {
    return [
      {
        providerInvoiceId: 'in_fake',
        status: 'paid',
        total: Money.of(9900, 'USD'),
        hostedInvoiceUrl: 'https://stripe.test/in_fake',
        invoicePdf: 'https://stripe.test/in_fake.pdf',
      },
    ];
  }

  async downloadInvoicePdf(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    return { filename: `${providerInvoiceId}.pdf`, content: new Uint8Array([1, 2, 3]) };
  }

  private unused(operation: string): Promise<never> {
    return Promise.reject(new Error(`FakeProvider.${operation} not used`));
  }
}
