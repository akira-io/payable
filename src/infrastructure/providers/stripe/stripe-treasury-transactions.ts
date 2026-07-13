import type Stripe from 'stripe';
import type {
  ListTreasuryTransactionsInput,
  TreasuryTransactionDTO,
} from '../../../domain/dtos/treasury.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripeTreasuryTransactionDTO } from './stripe-treasury-mappers';

const DEFAULT_TRANSACTION_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeTreasuryTransactions {
  constructor(
    private readonly client: () => Promise<Stripe>,
    private readonly requestOptions: () => Stripe.RequestOptions,
  ) {}

  async list(input: ListTreasuryTransactionsInput): Promise<TreasuryTransactionDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_TRANSACTION_LIMIT;
    const created: Stripe.RangeQueryParam = {};
    if (input.from) {
      created.gte = Math.floor(input.from.getTime() / 1000);
    }
    if (input.to) {
      created.lte = Math.floor(input.to.getTime() / 1000);
    }
    const params: Stripe.Treasury.TransactionListParams = {
      financial_account: input.providerAccountId,
      limit: Math.min(limit, STRIPE_PAGE_LIMIT),
    };
    if (Object.keys(created).length > 0) {
      params.created = created;
    }
    const transactions = await withStripeErrors(() =>
      stripe.treasury.transactions.list(params, this.requestOptions()).autoPagingToArray({ limit }),
    );
    return transactions.map(toStripeTreasuryTransactionDTO);
  }

  async retrieve(providerTransactionId: string): Promise<TreasuryTransactionDTO> {
    const stripe = await this.client();
    const transaction = await withStripeErrors(() =>
      stripe.treasury.transactions.retrieve(providerTransactionId, {}, this.requestOptions()),
    );
    return toStripeTreasuryTransactionDTO(transaction);
  }
}
