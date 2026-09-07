import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  RedirectCallbackContext,
  RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { trustMyTravelMoney } from './trust-my-travel-amounts';
import { validateTmtTransactionHash } from './trust-my-travel-authentication';
import type { TmtBookingResponse, TrustMyTravelBookings } from './trust-my-travel-bookings';
import { trustMyTravelPaymentStatus } from './trust-my-travel-payment-status';
import {
  asyncCallbackPayload,
  callbackPayload,
  failureCallbackPayload,
  type TmtFailureCallbackPayload,
} from './trust-my-travel-transaction-values';
import type { TrustMyTravelTransactions } from './trust-my-travel-transactions';

export class TrustMyTravelCallbacks {
  constructor(
    private readonly transactions: TrustMyTravelTransactions,
    private readonly bookings: TrustMyTravelBookings,
    private readonly channelSecret: string,
    private readonly channel: { id: number; currency: string },
    private readonly logger?: Logger,
  ) {}

  verify(payload: Record<string, unknown>, context?: RedirectCallbackContext): boolean {
    if (asyncCallbackPayload(payload)) return true;
    const callback = callbackPayload(payload);
    if (callback) return validateTmtTransactionHash(callback, this.channelSecret);
    return context?.checkoutSessionId !== undefined && failureCallbackPayload(payload) !== null;
  }

  async reconcile(
    payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): Promise<RedirectCallbackResult> {
    const failure = failureCallbackPayload(payload);
    if (failure && context?.checkoutSessionId !== undefined) {
      return await this.reconcileUnsettledAttempt(failure, context.checkoutSessionId);
    }
    const callback = callbackPayload(payload) ?? asyncCallbackPayload(payload);
    if (!callback || !this.verify(payload)) {
      throw new PayableError('Trust My Travel callback signature is invalid', {
        code: 'PROVIDER_TMT_INVALID_CALLBACK',
        context: { provider: 'trust-my-travel' },
      });
    }
    const transaction = await this.transactions.findScoped(callback.id);
    const bookingId = transaction.bookings[0]?.id;
    const linkedAuthorizationId =
      transaction.transaction_types === 'authorize'
        ? undefined
        : (transaction.linked_id ?? undefined);
    return {
      providerPaymentId: String(transaction.id),
      ...(linkedAuthorizationId !== undefined
        ? { checkoutSessionId: String(linkedAuthorizationId) }
        : bookingId === undefined
          ? {}
          : { checkoutSessionId: String(bookingId) }),
      status: trustMyTravelPaymentStatus(transaction, this.logger),
      amount: trustMyTravelMoney(transaction.total, transaction.currencies),
    };
  }

  private async reconcileUnsettledAttempt(
    failure: TmtFailureCallbackPayload,
    checkoutSessionId: string,
  ): Promise<RedirectCallbackResult> {
    const bookingId = Number(checkoutSessionId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      throw this.unconfirmed('Trust My Travel failure callback has no usable booking reference', {
        checkoutSessionId,
      });
    }
    const booking = await this.bookings.find(bookingId);
    this.assertBookingScope(booking);
    if (booking.transaction_ids.length > 0 || booking.total_unpaid !== booking.total) {
      throw this.unconfirmed('Trust My Travel booking does not confirm the reported failure', {
        bookingId,
        providerCode: failure.code,
        providerStatus: failure.status,
      });
    }
    this.logger?.warn('Trust My Travel reported an unsettled payment attempt', {
      provider: 'trust-my-travel',
      bookingId,
      providerCode: failure.code,
      providerStatus: failure.status,
    });
    return {
      providerPaymentId: String(booking.id),
      checkoutSessionId: String(booking.id),
      status: 'failed',
    };
  }

  private unconfirmed(message: string, context: Record<string, unknown>): PayableError {
    return new PayableError(message, {
      code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED',
      context: { provider: 'trust-my-travel', ...context },
    });
  }

  private assertBookingScope(booking: TmtBookingResponse): void {
    if (
      booking.channels !== this.channel.id ||
      CurrencyManager.normalize(booking.currencies) !==
        CurrencyManager.normalize(this.channel.currency)
    ) {
      throw new PayableError('Trust My Travel booking is outside the configured channel', {
        code: 'PROVIDER_TMT_TRANSACTION_SCOPE_MISMATCH',
        context: { provider: 'trust-my-travel', bookingId: booking.id },
      });
    }
  }
}
