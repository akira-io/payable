import type {
  IssuingCardDTO,
  IssuingCardStatus,
  IssuingTransactionDTO,
  IssuingTransactionType,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { revolutBusinessMoney } from './revolut-business-amounts';
import type { RevolutBusinessCard, RevolutBusinessTransaction } from './revolut-business-types';

const CARD_STATUS: Record<string, IssuingCardStatus> = {
  active: 'active',
  created: 'inactive',
  frozen: 'inactive',
  locked: 'blocked',
  pending: 'inactive',
  terminated: 'canceled',
};

export function toRevolutBusinessIssuingCardDTO(card: RevolutBusinessCard): IssuingCardDTO {
  const expiry = cardExpiry(card.expiry);
  return {
    providerCardId: card.id,
    providerCardholderId: card.holder_id ?? null,
    form: card.virtual ? 'virtual' : 'physical',
    status: CARD_STATUS[card.state] ?? 'unknown',
    brand: card.product?.scheme ?? card.product?.brand ?? card.product?.name ?? null,
    lastFour: card.last_digits,
    expiryMonth: expiry?.month ?? null,
    expiryYear: expiry?.year ?? null,
    createdAt: card.created_at ? new Date(card.created_at) : null,
  };
}

export function toRevolutBusinessIssuingTransactionDTO(
  transaction: RevolutBusinessTransaction,
): IssuingTransactionDTO {
  const providerCardId = revolutBusinessTransactionCardId(transaction);
  const leg = transaction.legs[0];
  if (!providerCardId || !leg) {
    throw new PayableError(
      'Revolut Business issuing transaction requires a card and monetary leg',
      {
        code: 'PROVIDER_RESPONSE_INVALID',
        context: { provider: 'revolut-business-issuing', transactionId: transaction.id },
      },
    );
  }
  return {
    providerTransactionId: transaction.id,
    providerCardId,
    amount: revolutBusinessMoney(leg.amount, leg.currency),
    type: issuingTransactionType(transaction),
    createdAt: transaction.created_at ? new Date(transaction.created_at) : null,
  };
}

export function revolutBusinessTransactionCardId(
  transaction: RevolutBusinessTransaction,
): string | null {
  return transaction.card?.id ?? transaction.card?.card_id ?? null;
}

function cardExpiry(value: string): { month: number; year: number } | null {
  const match = /^(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

function issuingTransactionType(transaction: RevolutBusinessTransaction): IssuingTransactionType {
  const type = transaction.type.toLowerCase();
  if (transaction.state === 'reverted' || type.includes('revert') || type.includes('reversal')) {
    return 'reversal';
  }
  if (type.includes('refund')) {
    return 'refund';
  }
  if (type.includes('card') || type.includes('cash_withdrawal')) {
    return 'capture';
  }
  return 'unknown';
}
