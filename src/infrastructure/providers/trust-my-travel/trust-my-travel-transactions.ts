import type { Logger } from '../../../domain/contracts/logger.contract';
import type { RedirectCallbackResult } from '../../../domain/contracts/payment-provider.contract';
import type {
  CapturePaymentInput,
  CaptureResultDTO,
  VoidPaymentInput,
  VoidResultDTO,
} from '../../../domain/dtos/payment-lifecycle.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import { trustMyTravelMoney } from './trust-my-travel-amounts';
import { validateTmtTransactionHash } from './trust-my-travel-authentication';
import type { TrustMyTravelRequest } from './trust-my-travel-client';
import {
  asyncCallbackPayload,
  callbackPayload,
  isTransactionBooking,
  positiveInteger,
  refundStatus,
} from './trust-my-travel-transaction-values';

export interface TmtTransactionResponse {
  id: number;
  status: string;
  total: number;
  total_remaining?: number;
  currencies: string;
  channels: number;
  bookings: TmtTransactionBooking[];
  transaction_types?: string;
  card_types?: string;
  last_four_digits?: string;
  token?: string;
  linked_id?: number;
  chargeback_status?: string;
  outcome_status?: string;
  reason_code?: string;
  challenge_date?: string;
}

export interface TmtTransactionBooking {
  id: number;
  currencies: string;
  total: number;
}

export class TrustMyTravelTransactions {
  constructor(
    private readonly request: TrustMyTravelRequest,
    private readonly channelSecret: string,
    private readonly channel: { id: number; currency: string },
    private readonly logger?: Logger,
  ) {}

  verifyCallback(payload: Record<string, unknown>): boolean {
    if (asyncCallbackPayload(payload)) return true;
    const callback = callbackPayload(payload);
    return callback ? validateTmtTransactionHash(callback, this.channelSecret) : false;
  }

  async reconcile(payload: Record<string, unknown>): Promise<RedirectCallbackResult> {
    const callback = callbackPayload(payload) ?? asyncCallbackPayload(payload);
    if (!callback || !this.verifyCallback(payload)) {
      throw new PayableError('Trust My Travel callback signature is invalid', {
        code: 'PROVIDER_TMT_INVALID_CALLBACK',
        context: { provider: 'trust-my-travel' },
      });
    }
    const transaction = await this.find(callback.id);
    this.assertTransactionScope(transaction);
    const bookingId = transaction.bookings[0]?.id;
    const linkedAuthorizationId =
      transaction.transaction_types === 'authorize' ? undefined : transaction.linked_id;
    return {
      providerPaymentId: String(transaction.id),
      ...(linkedAuthorizationId !== undefined
        ? { checkoutSessionId: String(linkedAuthorizationId) }
        : bookingId === undefined
          ? {}
          : { checkoutSessionId: String(bookingId) }),
      status: this.paymentStatus(transaction),
      amount: trustMyTravelMoney(transaction.total, transaction.currencies),
    };
  }

  async refund(input: RefundInput): Promise<RefundResultDTO> {
    const original = await this.find(input.providerPaymentId);
    this.assertTransactionScope(original);
    const remaining = original.total_remaining ?? original.total;
    const amount = input.amount?.amount() ?? remaining;
    const originalCurrency = CurrencyManager.normalize(original.currencies);
    const currency = CurrencyManager.normalize(input.amount?.currency() ?? original.currencies);
    if (currency !== originalCurrency) {
      throw this.refundError('Refund currency does not match the original transaction');
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
      throw this.refundError('Refund amount exceeds the remaining transaction amount');
    }
    const bookings = this.refundBookings(original, amount, input.providerData);
    const refund = await this.request<TmtTransactionResponse>('/transactions', {
      method: 'POST',
      body: {
        channels: original.channels,
        currencies: original.currencies,
        total: amount,
        transaction_types: 'refund',
        bookings,
        linked_id: original.id,
      },
    });
    return {
      providerRefundId: String(refund.id),
      status: refundStatus(refund.status),
      amount: trustMyTravelMoney(refund.total, refund.currencies),
    };
  }

  async capture(input: CapturePaymentInput): Promise<CaptureResultDTO> {
    const original = await this.authorizedTransaction(input.providerPaymentId);
    const amount = input.amount?.amount() ?? original.total;
    const currency = input.amount?.currency() ?? original.currencies;
    if (CurrencyManager.normalize(currency) !== CurrencyManager.normalize(original.currencies)) {
      throw this.lifecycleError('Capture currency does not match the authorization');
    }
    const bookings = (input.allocations ?? []).map((allocation) => ({
      id: positiveInteger(allocation.reference, 'allocation reference'),
      currencies: allocation.amount.currency(),
      total: allocation.amount.amount(),
    }));
    if (
      bookings.length === 0 ||
      bookings.reduce((sum, booking) => sum + booking.total, 0) !== amount
    ) {
      throw this.lifecycleError('Capture allocations must equal the captured amount');
    }
    const transaction = await this.request<TmtTransactionResponse>('/transactions', {
      method: 'POST',
      body: {
        channels: original.channels,
        currencies: original.currencies,
        total: amount,
        transaction_types: 'capture',
        bookings,
        linked_id: original.id,
      },
    });
    this.assertTransactionScope(transaction);
    return {
      providerPaymentId: String(transaction.id),
      status: transaction.status === 'complete' ? 'succeeded' : this.paymentStatus(transaction),
      amount: trustMyTravelMoney(transaction.total, transaction.currencies),
    };
  }

  async void(input: VoidPaymentInput): Promise<VoidResultDTO> {
    const original = await this.authorizedTransaction(input.providerPaymentId);
    const transaction = await this.request<TmtTransactionResponse>('/transactions', {
      method: 'POST',
      body: {
        channels: original.channels,
        currencies: original.currencies,
        total: original.total,
        transaction_types: 'void',
        bookings: original.bookings,
        linked_id: original.id,
      },
    });
    this.assertTransactionScope(transaction);
    return {
      providerPaymentId: String(transaction.id),
      status: transaction.status === 'complete' ? 'canceled' : this.paymentStatus(transaction),
    };
  }

  private async authorizedTransaction(id: string): Promise<TmtTransactionResponse> {
    const transaction = await this.find(id);
    this.assertTransactionScope(transaction);
    if (transaction.transaction_types !== 'authorize') {
      throw this.lifecycleError('Linked transaction is not an authorization');
    }
    return transaction;
  }

  private lifecycleError(message: string): PayableError {
    return new PayableError(message, {
      code: 'PROVIDER_TMT_PAYMENT_LIFECYCLE_INVALID',
      context: { provider: 'trust-my-travel' },
    });
  }

  find(id: string | number): Promise<TmtTransactionResponse> {
    return this.request<TmtTransactionResponse>(`/transactions/${encodeURIComponent(String(id))}`, {
      method: 'GET',
    });
  }

  async findScoped(id: string | number): Promise<TmtTransactionResponse> {
    const transaction = await this.find(id);
    this.assertTransactionScope(transaction);
    return transaction;
  }

  private refundError(message: string): PayableError {
    return new PayableError(message, {
      code: 'PROVIDER_TMT_REFUND_INVALID',
      context: { provider: 'trust-my-travel' },
    });
  }

  private refundBookings(
    original: TmtTransactionResponse,
    amount: number,
    providerData: Record<string, unknown> | undefined,
  ): TmtTransactionBooking[] {
    const supplied = providerData?.bookings;
    if (supplied !== undefined) {
      if (!Array.isArray(supplied) || !supplied.every(isTransactionBooking)) {
        throw this.refundError('Refund booking allocations are invalid');
      }
      if (new Set(supplied.map((booking) => booking.id)).size !== supplied.length) {
        throw this.refundError('Refund booking allocations contain duplicate booking ids');
      }
      const originals = new Map(original.bookings.map((booking) => [booking.id, booking]));
      const valid = supplied.every((booking) => {
        const source = originals.get(booking.id);
        return (
          source !== undefined &&
          booking.currencies === source.currencies &&
          booking.total > 0 &&
          booking.total <= source.total
        );
      });
      const total = supplied.reduce((sum, booking) => sum + booking.total, 0);
      if (!valid || total !== amount) {
        throw this.refundError('Refund booking allocations do not match the requested amount');
      }
      return supplied;
    }
    if (original.bookings.length !== 1) {
      throw this.refundError('Refunds across multiple bookings require providerData.bookings');
    }
    const [booking] = original.bookings;
    if (!booking) throw this.refundError('Original transaction has no booking allocation');
    return [{ ...booking, total: amount }];
  }

  private assertTransactionScope(transaction: TmtTransactionResponse): void {
    if (
      transaction.channels !== this.channel.id ||
      CurrencyManager.normalize(transaction.currencies) !==
        CurrencyManager.normalize(this.channel.currency)
    ) {
      throw new PayableError('Trust My Travel transaction is outside the configured channel', {
        code: 'PROVIDER_TMT_TRANSACTION_SCOPE_MISMATCH',
        context: { provider: 'trust-my-travel' },
      });
    }
  }

  private paymentStatus(transaction: TmtTransactionResponse): PaymentStatus {
    if (transaction.status === 'locked') {
      throw new PayableError('Trust My Travel transaction is locked', {
        code: 'PROVIDER_TRANSACTION_LOCKED',
        context: { provider: 'trust-my-travel', providerPaymentId: transaction.id },
      });
    }
    if (transaction.status === 'incomplete') {
      throw new PayableError('Trust My Travel transaction result is unknown', {
        code: 'PROVIDER_RESULT_UNKNOWN',
        context: { provider: 'trust-my-travel', providerPaymentId: transaction.id },
      });
    }
    if (transaction.status === 'expired') {
      this.logger?.warn('Trust My Travel transaction expired', {
        provider: 'trust-my-travel',
        providerPaymentId: transaction.id,
        providerStatus: transaction.status,
      });
    }
    if (transaction.status === 'complete') {
      if (transaction.transaction_types === 'authorize') return 'authorized';
      if (transaction.transaction_types === 'void') return 'canceled';
      return 'succeeded';
    }
    const statuses: Record<string, PaymentStatus> = {
      expired: 'failed',
      failed: 'failed',
      pending: 'processing',
    };
    return statuses[transaction.status] ?? 'pending';
  }
}
