import type { ChargeInput, ChargeResultDTO } from '../../../domain/dtos/charge.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { trustMyTravelMoney } from './trust-my-travel-amounts';
import type { TrustMyTravelClient } from './trust-my-travel-client';
import type { TmtTransactionBooking, TmtTransactionResponse } from './trust-my-travel-transactions';
import type {
  TrustMyTravelChannelResponse,
  TrustMyTravelEnvironment,
} from './trust-my-travel-types';
import type { TrustMyTravelVaultReferenceCodec } from './trust-my-travel-vault-reference';

interface CategoryOneDecline {
  transaction_id: number;
}

export class TrustMyTravelRetainedPurchases {
  constructor(
    private readonly client: TrustMyTravelClient,
    private readonly codec: TrustMyTravelVaultReferenceCodec,
    private readonly channelId: number,
    private readonly currency: string,
    private readonly environment: TrustMyTravelEnvironment,
  ) {}

  async charge(input: ChargeInput, _context: OperationContext): Promise<ChargeResultDTO> {
    const method = this.validateInput(input);
    if (method.sitePath !== this.client.sitePath) {
      throw retainedError('Trust My Travel retained purchase payment method is invalid');
    }
    const bookings = this.bookings(input);
    const targetChannel = await this.client.request<TrustMyTravelChannelResponse>(
      `/channels/${this.channelId}`,
      { method: 'GET' },
    );
    this.assertTargetScope(targetChannel, method.currency, method.accountType, method.environment);
    const vault = await this.client.request<TmtTransactionResponse>(
      `/transactions/${method.transactionId}`,
      { method: 'GET' },
    );
    this.assertVault(vault, method.transactionId, method.channelId, method.currency);
    await this.assertActive(method.transactionId);
    let transaction: TmtTransactionResponse;
    try {
      transaction = await this.client.request<TmtTransactionResponse>('/transactions', {
        method: 'POST',
        body: {
          channels: targetChannel.id,
          currencies: method.currency,
          total: input.amount.amount(),
          transaction_types: 'retained_purchase',
          bookings,
          linked_id: method.transactionId,
        },
      });
    } catch (error) {
      await this.assertActive(method.transactionId);
      throw new PayableError('Trust My Travel retained purchase outcome requires reconciliation', {
        code: 'PROVIDER_TMT_RETAINED_PURCHASE_OUTCOME_UNCERTAIN',
        context: { provider: 'trust-my-travel' },
        cause: error,
      });
    }
    if (
      !Number.isSafeInteger(transaction.id) ||
      transaction.id <= 0 ||
      transaction.transaction_types !== 'retained_purchase' ||
      transaction.linked_id !== method.transactionId ||
      transaction.channels !== targetChannel.id ||
      CurrencyManager.normalize(transaction.currencies) !== method.currency ||
      transaction.total !== input.amount.amount()
    ) {
      throw retainedError('Trust My Travel retained purchase response is outside request scope');
    }
    return {
      providerPaymentId: String(transaction.id),
      status: transaction.status === 'complete' ? 'succeeded' : this.status(transaction.status),
      amount: trustMyTravelMoney(transaction.total, transaction.currencies),
    };
  }

  idempotencyFingerprint(input: ChargeInput): unknown {
    return { bookings: this.bookings(input) };
  }

  isFailureOutcomeUncertain(error: unknown): boolean {
    return (
      error instanceof PayableError &&
      error.code === 'PROVIDER_TMT_RETAINED_PURCHASE_OUTCOME_UNCERTAIN'
    );
  }

  private validateInput(input: ChargeInput) {
    if (
      input.offSession !== true ||
      !input.paymentMethodId ||
      input.amount.amount() <= 0 ||
      CurrencyManager.normalize(input.amount.currency()) !==
        CurrencyManager.normalize(this.currency) ||
      (input.providerData && Object.keys(input.providerData).some((key) => key !== 'bookings'))
    ) {
      throw retainedError('Trust My Travel retained purchase input is invalid');
    }
    try {
      return this.codec.openPaymentMethod(input.paymentMethodId);
    } catch {
      throw retainedError('Trust My Travel retained purchase payment method is invalid');
    }
  }

  private bookings(input: ChargeInput): TmtTransactionBooking[] {
    const supplied = input.providerData?.bookings;
    if (!Array.isArray(supplied) || supplied.length === 0) {
      throw retainedError('Trust My Travel retained purchase bookings are required');
    }
    const bookings = supplied.map((value) => {
      if (!isBooking(value))
        throw retainedError('Trust My Travel retained purchase booking is invalid');
      return { id: value.id, currencies: value.currencies, total: value.total };
    });
    const uniqueIds = new Set(bookings.map((booking) => booking.id));
    const total = bookings.reduce((sum, booking) => sum + booking.total, 0);
    if (
      uniqueIds.size !== bookings.length ||
      total !== input.amount.amount() ||
      bookings.some(
        (booking) =>
          CurrencyManager.normalize(booking.currencies) !==
          CurrencyManager.normalize(this.currency),
      )
    ) {
      throw retainedError('Trust My Travel retained purchase bookings do not match the charge');
    }
    return bookings;
  }

  private assertTargetScope(
    channel: TrustMyTravelChannelResponse,
    currency: string,
    accountType: string,
    environment: string,
  ): void {
    if (
      channel.id !== this.channelId ||
      CurrencyManager.normalize(channel.currencies) !== currency ||
      channel.account_type !== accountType ||
      channel.account_mode !== environment ||
      channel.account_mode !== this.environment
    ) {
      throw new PayableError('Trust My Travel retained purchase channel scope does not match', {
        code: 'PROVIDER_TMT_RETAINED_PURCHASE_SCOPE_MISMATCH',
        context: { provider: 'trust-my-travel' },
      });
    }
  }

  private assertVault(
    transaction: TmtTransactionResponse,
    id: number,
    channelId: number,
    currency: string,
  ): void {
    if (
      transaction.id !== id ||
      transaction.status !== 'complete' ||
      transaction.transaction_types !== 'vault' ||
      transaction.total !== 0 ||
      transaction.channels !== channelId ||
      CurrencyManager.normalize(transaction.currencies) !== currency
    ) {
      throw retainedError('Trust My Travel vaulted payment method cannot be verified');
    }
  }

  private async assertActive(transactionId: number): Promise<void> {
    const declines = await this.client.request<CategoryOneDecline[]>(
      `/category-one-declines?transaction_id=${transactionId}&per_page=1`,
      { method: 'GET' },
    );
    if (declines.some((decline) => decline.transaction_id === transactionId)) {
      throw new PayableError('The payment method was permanently invalidated by the provider', {
        code: 'PROVIDER_PAYMENT_METHOD_PERMANENTLY_INVALID',
        context: { provider: 'trust-my-travel' },
      });
    }
  }

  private status(status: string): ChargeResultDTO['status'] {
    if (status === 'failed' || status === 'expired') return 'failed';
    if (status === 'pending') return 'processing';
    throw new PayableError('Trust My Travel retained purchase result is unknown', {
      code: 'PROVIDER_RESULT_UNKNOWN',
      context: { provider: 'trust-my-travel' },
    });
  }
}

function isBooking(value: unknown): value is TmtTransactionBooking {
  if (!value || typeof value !== 'object') return false;
  const booking = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(booking.id) &&
    Number(booking.id) > 0 &&
    typeof booking.currencies === 'string' &&
    Number.isSafeInteger(booking.total) &&
    Number(booking.total) > 0
  );
}

function retainedError(message: string): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_TMT_RETAINED_PURCHASE_INVALID',
    context: { provider: 'trust-my-travel' },
  });
}
