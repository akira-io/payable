import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import type { TmtBookingResponse } from './trust-my-travel-bookings';

export interface TmtChannelScope {
  id: number;
  currency: string;
}

export function assertBookingScope(booking: TmtBookingResponse, channel: TmtChannelScope): void {
  if (
    booking.channels !== channel.id ||
    CurrencyManager.normalize(booking.currencies) !== CurrencyManager.normalize(channel.currency)
  ) {
    throw new PayableError('Trust My Travel booking is outside the configured channel', {
      code: 'PROVIDER_TMT_BOOKING_SCOPE_MISMATCH',
      context: { provider: 'trust-my-travel', bookingId: booking.id },
    });
  }
}

export function settledNothing(booking: TmtBookingResponse): boolean {
  return (
    Array.isArray(booking.transaction_ids) &&
    booking.transaction_ids.length === 0 &&
    Number.isInteger(booking.total) &&
    booking.total_unpaid === booking.total
  );
}

export function bookingReference(checkoutSessionId: string | undefined): number | null {
  if (checkoutSessionId === undefined || !/^[1-9]\d*$/u.test(checkoutSessionId)) return null;
  const bookingId = Number(checkoutSessionId);
  return Number.isSafeInteger(bookingId) ? bookingId : null;
}
