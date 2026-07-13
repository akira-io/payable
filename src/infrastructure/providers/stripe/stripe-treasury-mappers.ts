import type Stripe from 'stripe';
import type {
  TreasuryAccountDTO,
  TreasuryAccountStatus,
  TreasuryTransactionDTO,
  TreasuryTransactionStatus,
  TreasuryTransferDestination,
  TreasuryTransferDTO,
} from '../../../domain/dtos/treasury.dto';
import { stripeMoney } from './stripe-amounts';

const TRANSACTION_STATUS: Record<Stripe.Treasury.Transaction.Status, TreasuryTransactionStatus> = {
  open: 'pending',
  posted: 'completed',
  void: 'canceled',
};

const TRANSFER_STATUS: Record<Stripe.Treasury.OutboundTransfer.Status, TreasuryTransactionStatus> =
  {
    processing: 'pending',
    posted: 'completed',
    failed: 'failed',
    canceled: 'canceled',
    returned: 'reversed',
  };

const ACCOUNT_STATUS: Record<Stripe.Treasury.FinancialAccount.Status, TreasuryAccountStatus> = {
  open: 'open',
  closed: 'closed',
};

export function toStripeTreasuryAccountDTO(
  account: Stripe.Treasury.FinancialAccount,
): TreasuryAccountDTO {
  const currencies = new Set([
    ...account.supported_currencies,
    ...Object.keys(account.balance.cash),
    ...Object.keys(account.balance.inbound_pending),
    ...Object.keys(account.balance.outbound_pending),
  ]);
  return {
    providerAccountId: account.id,
    name: account.nickname ?? null,
    status: ACCOUNT_STATUS[account.status] ?? 'unknown',
    country: account.country ?? null,
    balances: [...currencies].map((currency) => {
      const available = account.balance.cash[currency] ?? 0;
      const inboundPending = account.balance.inbound_pending[currency] ?? 0;
      const outboundPending = account.balance.outbound_pending[currency] ?? 0;
      return {
        current: stripeMoney(available + inboundPending + outboundPending, currency),
        available: stripeMoney(available, currency),
        inboundPending: stripeMoney(inboundPending, currency),
        outboundPending: stripeMoney(outboundPending, currency),
      };
    }),
    createdAt: unixDate(account.created),
    updatedAt: null,
  };
}

export function toStripeTreasuryTransactionDTO(
  transaction: Stripe.Treasury.Transaction,
): TreasuryTransactionDTO {
  return {
    providerTransactionId: transaction.id,
    type: transaction.flow_type,
    status: TRANSACTION_STATUS[transaction.status] ?? 'unknown',
    reference: transaction.description || null,
    legs: [
      {
        providerAccountId: transaction.financial_account,
        providerCounterpartyId: null,
        amount: stripeMoney(transaction.amount, transaction.currency),
        fee: null,
        balance: null,
        description: transaction.description || null,
      },
    ],
    createdAt: unixDate(transaction.created),
    completedAt: unixDate(
      transaction.status_transitions.posted_at ?? transaction.status_transitions.void_at,
    ),
  };
}

export function toStripeTreasuryTransferDTO(
  transfer: Stripe.Treasury.OutboundTransfer,
): TreasuryTransferDTO {
  return toStripeTreasuryMovementDTO(transfer, stripeTransferDestination(transfer));
}

export function toStripeTreasuryOutboundPaymentDTO(
  payment: Stripe.Treasury.OutboundPayment,
): TreasuryTransferDTO {
  const destination: TreasuryTransferDestination | null = payment.destination_payment_method
    ? {
        type: 'payment_method',
        providerPaymentMethodId: payment.destination_payment_method,
      }
    : null;
  return toStripeTreasuryMovementDTO(payment, destination);
}

function toStripeTreasuryMovementDTO(
  movement: Stripe.Treasury.OutboundTransfer | Stripe.Treasury.OutboundPayment,
  destination: TreasuryTransferDestination | null,
): TreasuryTransferDTO {
  return {
    providerTransferId: movement.id,
    sourceProviderAccountId: movement.financial_account,
    destination,
    amount: stripeMoney(movement.amount, movement.currency),
    status: TRANSFER_STATUS[movement.status] ?? 'unknown',
    reference: movement.description ?? null,
    createdAt: unixDate(movement.created),
    completedAt: unixDate(
      movement.status_transitions.posted_at ??
        movement.status_transitions.returned_at ??
        movement.status_transitions.failed_at ??
        movement.status_transitions.canceled_at,
    ),
  };
}

function stripeTransferDestination(
  transfer: Stripe.Treasury.OutboundTransfer,
): TreasuryTransferDestination | null {
  const financialAccount = transfer.destination_payment_method_details.financial_account;
  if (financialAccount) {
    return { type: 'account', providerAccountId: financialAccount.id };
  }
  if (transfer.destination_payment_method) {
    return {
      type: 'payment_method',
      providerPaymentMethodId: transfer.destination_payment_method,
    };
  }
  return null;
}

function unixDate(timestamp: number | null | undefined): Date | null {
  return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}
