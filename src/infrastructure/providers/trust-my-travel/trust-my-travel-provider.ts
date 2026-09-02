import type {
  PaymentProvider,
  RedirectCallbackCapable,
  RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import type {
  RecurringPaymentReconciliationCapable,
  RecurringPaymentReconciliationInput,
  RecurringPaymentReconciliationResult,
} from '../../../domain/contracts/recurring-payment-reconciliation.contract';
import type { SubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { NO_SUBSCRIPTION_OPERATIONS } from '../../../domain/dtos/subscription-operation-capabilities.dto';
import { SystemClock } from '../../../support/clock/system-clock';
import { TrustMyTravelBookings } from './trust-my-travel-bookings';
import { TrustMyTravelCheckout } from './trust-my-travel-checkout';
import { TrustMyTravelClient } from './trust-my-travel-client';
import { TrustMyTravelReconciliation } from './trust-my-travel-reconciliation';
import { TrustMyTravelTransactions } from './trust-my-travel-transactions';
import type { TrustMyTravelProviderOptions } from './trust-my-travel-types';

export class TrustMyTravelProvider
  implements
    PaymentProvider,
    RedirectCallbackCapable,
    RecurringPaymentReconciliationCapable,
    SubscriptionOperationCapabilitiesProvider
{
  readonly name = 'trust-my-travel';
  readonly bookings: TrustMyTravelBookings;
  private readonly checkout: TrustMyTravelCheckout;
  private readonly transactions: TrustMyTravelTransactions;
  private readonly reconciliation: TrustMyTravelReconciliation;

  constructor(options: TrustMyTravelProviderOptions) {
    const client = new TrustMyTravelClient(options);
    const request = client.request.bind(client);
    this.bookings = new TrustMyTravelBookings(request, {
      channelId: options.channelId,
      currency: options.currency,
    });
    this.checkout = new TrustMyTravelCheckout(this.bookings, options);
    this.transactions = new TrustMyTravelTransactions(
      request,
      options.channelSecret,
      { id: options.channelId, currency: options.currency },
      options.logger,
    );
    this.reconciliation = new TrustMyTravelReconciliation(
      (id) => this.transactions.findScoped(id),
      options.clock ?? new SystemClock(),
      options.reconciliation,
    );
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `TrustMyTravelProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set(['checkout', 'refunds', 'x-tmt-bookings']);
  }

  subscriptionOperationCapabilities() {
    return NO_SUBSCRIPTION_OPERATIONS;
  }

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    _ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    return this.checkout.create(input);
  }

  refund(input: RefundInput, _ctx: OperationContext): Promise<RefundResultDTO> {
    return this.transactions.refund(input);
  }

  verifyCallback(payload: Record<string, unknown>): boolean {
    return this.transactions.verifyCallback(payload);
  }

  handleRedirectCallback(payload: Record<string, unknown>): Promise<RedirectCallbackResult> {
    return this.transactions.reconcile(payload);
  }

  reconcilePaymentRecurring(
    input: RecurringPaymentReconciliationInput,
  ): Promise<RecurringPaymentReconciliationResult> {
    return this.reconciliation.reconcile(input);
  }
}
