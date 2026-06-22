import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type {
  BillingPortalDTO,
  ChargeResultDTO,
  CheckoutSessionDTO,
  CustomerDTO,
  InvoiceDTO,
  InvoicePdfDTO,
  PriceDTO,
  ProductDTO,
  ProviderCapabilities,
  RefundResultDTO,
  SubscriptionDTO,
  VerifiedWebhook,
} from '../../../domain/dtos';
import { PayableError } from '../../../domain/errors/payable-error';

export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
}

// TODO: Phase 13
export class PaddleProvider implements PaymentProvider {
  readonly name = 'paddle';

  constructor(protected readonly options: PaddleProviderOptions) {}

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

  createCustomer(): Promise<CustomerDTO> {
    return this.unsupported('createCustomer');
  }

  updateCustomer(): Promise<CustomerDTO> {
    return this.unsupported('updateCustomer');
  }

  createProduct(): Promise<ProductDTO> {
    return this.unsupported('createProduct');
  }

  updateProduct(): Promise<ProductDTO> {
    return this.unsupported('updateProduct');
  }

  createPrice(): Promise<PriceDTO> {
    return this.unsupported('createPrice');
  }

  createCheckoutSession(): Promise<CheckoutSessionDTO> {
    return this.unsupported('createCheckoutSession');
  }

  createSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('createSubscription');
  }

  updateSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('updateSubscription');
  }

  cancelSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('cancelSubscription');
  }

  resumeSubscription(): Promise<SubscriptionDTO> {
    return this.unsupported('resumeSubscription');
  }

  charge(): Promise<ChargeResultDTO> {
    return this.unsupported('charge');
  }

  refund(): Promise<RefundResultDTO> {
    return this.unsupported('refund');
  }

  verifyWebhook(): Promise<VerifiedWebhook> {
    return this.unsupported('verifyWebhook');
  }

  billingPortal(): Promise<BillingPortalDTO> {
    return this.unsupported('billingPortal');
  }

  listInvoices(): Promise<InvoiceDTO[]> {
    return this.unsupported('listInvoices');
  }

  downloadInvoicePdf(): Promise<InvoicePdfDTO> {
    return this.unsupported('downloadInvoicePdf');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`PaddleProvider.${op} (Phase 13)`);
  }
}
