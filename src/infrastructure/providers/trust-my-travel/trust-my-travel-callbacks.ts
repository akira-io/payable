import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  RedirectCallbackContext,
  RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { trustMyTravelMoney } from './trust-my-travel-amounts';
import { validateTmtTransactionHash } from './trust-my-travel-authentication';
import { trustMyTravelPaymentStatus } from './trust-my-travel-payment-status';
import {
  asyncCallbackPayload,
  callbackPayload,
  failureCallbackPayload,
  type TmtFailureCallbackPayload,
} from './trust-my-travel-transaction-values';
import type { TrustMyTravelTransactions } from './trust-my-travel-transactions';

const UNSETTLED_ATTEMPT_MESSAGE =
  'Trust My Travel did not report a decision on the payment attempt';

export class TrustMyTravelCallbacks {
  constructor(
    private readonly transactions: TrustMyTravelTransactions,
    private readonly channelSecret: string,
    private readonly logger?: Logger,
  ) {}

  verify(payload: Record<string, unknown>, context?: RedirectCallbackContext): boolean {
    if (asyncCallbackPayload(payload)) return true;
    const callback = callbackPayload(payload);
    if (callback) return validateTmtTransactionHash(callback, this.channelSecret);
    return bookingReference(context) !== null && failureCallbackPayload(payload) !== null;
  }

  async reconcile(
    payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): Promise<RedirectCallbackResult> {
    const failure = failureCallbackPayload(payload);
    const unsettledBookingId = bookingReference(context);
    if (failure && unsettledBookingId !== null) {
      this.refuseUnsettledAttempt(failure, unsettledBookingId);
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

  private refuseUnsettledAttempt(failure: TmtFailureCallbackPayload, bookingId: number): never {
    const context = {
      provider: 'trust-my-travel',
      bookingId,
      providerCode: failure.code,
      providerStatus: failure.status,
    };
    this.logger?.warn(UNSETTLED_ATTEMPT_MESSAGE, context);
    throw new PayableError(UNSETTLED_ATTEMPT_MESSAGE, {
      code: 'PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED',
      context,
    });
  }
}

function bookingReference(context: RedirectCallbackContext | undefined): number | null {
  const checkoutSessionId = context?.checkoutSessionId;
  if (checkoutSessionId === undefined || !/^[1-9]\d*$/u.test(checkoutSessionId)) return null;
  const bookingId = Number(checkoutSessionId);
  return Number.isSafeInteger(bookingId) ? bookingId : null;
}
