import type { PaymentProvider } from '../../src/domain/contracts/payment-provider.contract';
import type {
  BillingPortalDTO,
  BillingPortalInput,
} from '../../src/domain/dtos/billing-portal.dto';
import type { ProviderCapabilities } from '../../src/domain/dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../../src/domain/dtos/charge.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../src/domain/dtos/checkout.dto';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { CreateCustomerInput, CustomerDTO } from '../../src/domain/dtos/customer.dto';
import type {
  InvoiceDTO,
  InvoicePdfDTO,
  ListInvoicesInput,
} from '../../src/domain/dtos/invoice.dto';
import type { PriceDTO } from '../../src/domain/dtos/price.dto';
import type { ProductDTO } from '../../src/domain/dtos/product.dto';
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
  lastCheckout?: { input: CreateCheckoutSessionInput; ctx: OperationContext };
  verifyResult?: VerifiedWebhook;
  verifyError?: Error;
  reconcileResult?: SubscriptionDTO | null;
  lastVerifyInput?: WebhookVerificationInput;
  createdSubscriptions = 0;
  lastSubscriptionUpdate?: UpdateSubscriptionInput;
  lastSubscriptionUpdateCtx?: OperationContext;
  lastCreateSubscription?: CreateSubscriptionInput;
  lastChargeCtx?: OperationContext;
  lastRefundInput?: RefundInput;

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

  updateCustomer(): Promise<CustomerDTO> {
    return this.unused('updateCustomer');
  }

  createProduct(): Promise<ProductDTO> {
    return this.unused('createProduct');
  }

  updateProduct(): Promise<ProductDTO> {
    return this.unused('updateProduct');
  }

  createPrice(): Promise<PriceDTO> {
    return this.unused('createPrice');
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
    return { providerPaymentId: 'pi_fake', status: 'succeeded', amount: input.amount };
  }

  async refund(input: RefundInput): Promise<RefundResultDTO> {
    this.lastRefundInput = input;
    return {
      providerRefundId: 're_fake',
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
