import type {
  CheckoutSessionReconciliationInput,
  CheckoutSessionReconciliationResult,
} from '../../../domain/contracts/checkout-session-reconciliation.contract';
import type { Logger } from '../../../domain/contracts/logger.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { trustMyTravelMoney } from './trust-my-travel-amounts';
import {
  assertBookingScope,
  bookingReference,
  settledNothing,
  type TmtChannelScope,
} from './trust-my-travel-booking-settlement';
import type { TrustMyTravelBookings } from './trust-my-travel-bookings';

export class TrustMyTravelCheckoutReconciliation {
  constructor(
    private readonly bookings: TrustMyTravelBookings,
    private readonly channel: TmtChannelScope,
    private readonly logger?: Logger,
  ) {}

  async reconcile(
    input: CheckoutSessionReconciliationInput,
  ): Promise<CheckoutSessionReconciliationResult> {
    const bookingId = bookingReference(input.checkoutSessionId);
    if (bookingId === null) {
      throw new PayableError('Trust My Travel checkout session id must be a booking id', {
        code: 'PROVIDER_TMT_CHECKOUT_SESSION_INVALID',
        context: { provider: 'trust-my-travel' },
      });
    }
    const booking = await this.bookings.find(bookingId);
    if (booking.id !== bookingId) {
      throw new PayableError('Trust My Travel returned a different booking', {
        code: 'PROVIDER_TMT_BOOKING_ID_MISMATCH',
        context: { provider: 'trust-my-travel', bookingId },
      });
    }
    assertBookingScope(booking, this.channel);
    const transactionIds = booking.transaction_ids;
    if (Array.isArray(transactionIds) && transactionIds.length > 0) {
      return {
        outcome: 'settled',
        checkoutSessionId: String(booking.id),
        providerPaymentIds: transactionIds.map((id) => String(id)),
      };
    }
    if (!settledNothing(booking)) {
      throw new PayableError('Trust My Travel booking does not report a usable settlement state', {
        code: 'PROVIDER_TMT_BOOKING_SETTLEMENT_UNCLEAR',
        context: { provider: 'trust-my-travel', bookingId: booking.id },
      });
    }
    this.logger?.warn('Trust My Travel checkout session settled nothing', {
      provider: 'trust-my-travel',
      bookingId: booking.id,
    });
    return {
      outcome: 'unsettled',
      checkoutSessionId: String(booking.id),
      status: 'failed',
      amount: trustMyTravelMoney(booking.total, booking.currencies),
    };
  }
}
