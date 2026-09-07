import { createHash } from 'node:crypto';
import type {
  CheckoutSessionReconciliationCapable,
  CheckoutSessionReconciliationInput,
  CheckoutSessionReconciliationResult,
} from '../../../domain/contracts/checkout-session-reconciliation.contract';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  AuthorizeCapable,
  CaptureCapable,
  VoidCapable,
} from '../../../domain/contracts/payment-lifecycle-provider.contract';
import type {
  ChargeCapable,
  PaymentMethodSetupCapable,
  PaymentMethodSetupConfirmationCapable,
  PaymentProvider,
  RedirectCallbackCapable,
  RedirectCallbackContext,
  RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import type {
  RecurringPaymentReconciliationCapable,
  RecurringPaymentReconciliationInput,
  RecurringPaymentReconciliationResult,
} from '../../../domain/contracts/recurring-payment-reconciliation.contract';
import type { SubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type { ChargeInput, ChargeResultDTO } from '../../../domain/dtos/charge.dto';
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
import type {
  ConfirmPaymentMethodSetupInput,
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupDTO,
} from '../../../domain/dtos/payment-method-setup.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { NO_SUBSCRIPTION_OPERATIONS } from '../../../domain/dtos/subscription-operation-capabilities.dto';
import { SystemClock } from '../../../support/clock/system-clock';
import { TrustMyTravelBookings } from './trust-my-travel-bookings';
import { TrustMyTravelCallbacks } from './trust-my-travel-callbacks';
import { TrustMyTravelCardVault } from './trust-my-travel-card-vault';
import { TrustMyTravelCheckout } from './trust-my-travel-checkout';
import { TrustMyTravelCheckoutReconciliation } from './trust-my-travel-checkout-reconciliation';
import { TrustMyTravelClient } from './trust-my-travel-client';
import { TrustMyTravelReconciliation } from './trust-my-travel-reconciliation';
import { TrustMyTravelRetainedPurchases } from './trust-my-travel-retained-purchases';
import { TrustMyTravelTransactions } from './trust-my-travel-transactions';
import type { TrustMyTravelProviderOptions } from './trust-my-travel-types';
import { TrustMyTravelVaultReferenceCodec } from './trust-my-travel-vault-reference';

export class TrustMyTravelProvider
  implements
    PaymentProvider,
    AuthorizeCapable,
    CaptureCapable,
    VoidCapable,
    ChargeCapable,
    PaymentMethodSetupCapable,
    PaymentMethodSetupConfirmationCapable,
    RedirectCallbackCapable,
    RecurringPaymentReconciliationCapable,
    CheckoutSessionReconciliationCapable,
    SubscriptionOperationCapabilitiesProvider
{
  readonly name = 'trust-my-travel';
  readonly authorizeIdempotency = 'unsupported';
  readonly chargeIdempotency = 'unsupported';
  readonly captureIdempotency = 'unsupported';
  readonly voidIdempotency = 'unsupported';
  readonly bookings: TrustMyTravelBookings;
  private readonly checkout: TrustMyTravelCheckout;
  private readonly transactions: TrustMyTravelTransactions;
  private readonly callbacks: TrustMyTravelCallbacks;
  private readonly reconciliation: TrustMyTravelReconciliation;
  private readonly checkoutReconciliation: TrustMyTravelCheckoutReconciliation;
  private readonly clock: Clock;
  private readonly authorizationWindowMs: number;
  private readonly cardVault: TrustMyTravelCardVault;
  private readonly retainedPurchases: TrustMyTravelRetainedPurchases;

  constructor(options: TrustMyTravelProviderOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.authorizationWindowMs = options.authorizationWindowMs ?? 5 * 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(this.authorizationWindowMs) || this.authorizationWindowMs <= 0) {
      throw new TypeError('Trust My Travel authorizationWindowMs must be a positive integer');
    }
    assertVaultReferenceSecrets(options.vaultReferenceSecrets);
    const client = new TrustMyTravelClient(options);
    const vaultReferenceCodec = new TrustMyTravelVaultReferenceCodec(
      options.vaultReferenceSecrets ?? [
        createHash('sha256').update(options.channelSecret).digest('hex'),
      ],
    );
    const request = client.request.bind(client);
    this.bookings = new TrustMyTravelBookings(request, {
      channelId: options.channelId,
      currency: options.currency,
    });
    this.checkout = new TrustMyTravelCheckout(this.bookings, options);
    this.transactions = new TrustMyTravelTransactions(
      request,
      { id: options.channelId, currency: options.currency },
      options.logger,
    );
    this.callbacks = new TrustMyTravelCallbacks(
      this.transactions,
      options.channelSecret,
      options.logger,
    );
    this.reconciliation = new TrustMyTravelReconciliation(
      (id) => this.transactions.findScoped(id),
      this.clock,
      options.reconciliation,
    );
    this.checkoutReconciliation = new TrustMyTravelCheckoutReconciliation(
      this.bookings,
      { id: options.channelId, currency: options.currency },
      options.logger,
    );
    this.cardVault = new TrustMyTravelCardVault(
      client,
      vaultReferenceCodec,
      options.channelId,
      options.currency,
      options.environment,
      this.clock,
    );
    this.retainedPurchases = new TrustMyTravelRetainedPurchases(
      client,
      vaultReferenceCodec,
      options.channelId,
      options.currency,
      options.environment,
    );
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `TrustMyTravelProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set([
      'checkout',
      'refunds',
      'charges',
      'authorize',
      'capture',
      'void',
      'paymentMethodSetup',
      'x-tmt-bookings',
    ]);
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

  createPaymentMethodSetup(
    input: CreatePaymentMethodSetupInput,
    context: OperationContext,
  ): Promise<PaymentMethodSetupDTO> {
    return this.cardVault.create(input, context);
  }

  retrievePaymentMethodSetup(providerSetupId: string): Promise<PaymentMethodSetupDTO> {
    return this.cardVault.retrieve(providerSetupId);
  }

  cancelPaymentMethodSetup(
    providerSetupId: string,
    _context: OperationContext,
  ): Promise<PaymentMethodSetupDTO> {
    return this.cardVault.cancel(providerSetupId);
  }

  confirmPaymentMethodSetup(input: ConfirmPaymentMethodSetupInput): Promise<PaymentMethodSetupDTO> {
    return this.cardVault.confirm(input);
  }

  charge(input: ChargeInput, context: OperationContext): Promise<ChargeResultDTO> {
    return this.retainedPurchases.charge(input, context);
  }

  chargeIdempotencyFingerprint(input: ChargeInput): unknown {
    return this.retainedPurchases.idempotencyFingerprint(input);
  }

  isChargeFailureOutcomeUncertain(error: unknown): boolean {
    return this.retainedPurchases.isFailureOutcomeUncertain(error);
  }

  verifyCallback(payload: Record<string, unknown>, context?: RedirectCallbackContext): boolean {
    return this.callbacks.verify(payload, context);
  }

  handleRedirectCallback(
    payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): Promise<RedirectCallbackResult> {
    return this.callbacks.reconcile(payload, context);
  }

  reconcilePaymentRecurring(
    input: RecurringPaymentReconciliationInput,
  ): Promise<RecurringPaymentReconciliationResult> {
    return this.reconciliation.reconcile(input);
  }

  reconcileCheckoutSession(
    input: CheckoutSessionReconciliationInput,
  ): Promise<CheckoutSessionReconciliationResult> {
    return this.checkoutReconciliation.reconcile(input);
  }
}

function assertVaultReferenceSecrets(secrets: readonly string[] | undefined): void {
  if (
    secrets &&
    (secrets.length === 0 ||
      secrets.some((secret) => typeof secret !== 'string' || Buffer.byteLength(secret) < 32))
  ) {
    throw new TypeError('Trust My Travel vault reference secrets must contain at least 32 bytes');
  }
}
