import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  AuthorizeCapable,
  CaptureCapable,
  VoidCapable,
} from '../../../domain/contracts/payment-lifecycle-provider.contract';
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
import type {
  AuthorizationResultDTO,
  AuthorizePaymentInput,
  CapturePaymentInput,
  CaptureResultDTO,
  VoidPaymentInput,
  VoidResultDTO,
} from '../../../domain/dtos/payment-lifecycle.dto';
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
    AuthorizeCapable,
    CaptureCapable,
    VoidCapable,
    RedirectCallbackCapable,
    RecurringPaymentReconciliationCapable,
    SubscriptionOperationCapabilitiesProvider
{
  readonly name = 'trust-my-travel';
  readonly authorizeIdempotency = 'unsupported';
  readonly captureIdempotency = 'unsupported';
  readonly voidIdempotency = 'unsupported';
  readonly bookings: TrustMyTravelBookings;
  private readonly checkout: TrustMyTravelCheckout;
  private readonly transactions: TrustMyTravelTransactions;
  private readonly reconciliation: TrustMyTravelReconciliation;
  private readonly clock: Clock;
  private readonly authorizationWindowMs: number;

  constructor(options: TrustMyTravelProviderOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.authorizationWindowMs = options.authorizationWindowMs ?? 5 * 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(this.authorizationWindowMs) || this.authorizationWindowMs <= 0) {
      throw new TypeError('Trust My Travel authorizationWindowMs must be a positive integer');
    }
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
      this.clock,
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
    return new Set(['checkout', 'refunds', 'authorize', 'capture', 'void', 'x-tmt-bookings']);
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

  async authorize(
    input: AuthorizePaymentInput,
    _ctx: OperationContext,
  ): Promise<AuthorizationResultDTO> {
    const checkout = await this.checkout.create(
      {
        providerCustomerId: input.providerCustomerId ?? '',
        mode: 'payment',
        lineItems: [],
        successUrl: input.successUrl ?? '',
        cancelUrl: input.cancelUrl ?? '',
        reference: input.reference,
        amount: input.amount,
        providerData: input.providerData,
      },
      'authorize',
    );
    return {
      status: 'processing',
      amount: input.amount,
      checkout,
      expiresAt: new Date(this.clock.now().getTime() + this.authorizationWindowMs),
    };
  }

  capture(input: CapturePaymentInput, _ctx: OperationContext): Promise<CaptureResultDTO> {
    return this.transactions.capture(input);
  }

  void(input: VoidPaymentInput, _ctx: OperationContext): Promise<VoidResultDTO> {
    return this.transactions.void(input);
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
