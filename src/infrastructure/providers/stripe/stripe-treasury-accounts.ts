import type Stripe from 'stripe';
import type {
  ListTreasuryAccountsInput,
  TreasuryAccountDTO,
} from '../../../domain/dtos/treasury.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripeTreasuryAccountDTO } from './stripe-treasury-mappers';

const DEFAULT_ACCOUNT_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeTreasuryAccounts {
  constructor(
    private readonly client: () => Promise<Stripe>,
    private readonly requestOptions: () => Stripe.RequestOptions,
  ) {}

  async list(input: ListTreasuryAccountsInput = {}): Promise<TreasuryAccountDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_ACCOUNT_LIMIT;
    const accounts = await withStripeErrors(() =>
      stripe.treasury.financialAccounts
        .list({ limit: Math.min(limit, STRIPE_PAGE_LIMIT) }, this.requestOptions())
        .autoPagingToArray({ limit }),
    );
    return accounts.map(toStripeTreasuryAccountDTO);
  }

  async retrieve(providerAccountId: string): Promise<TreasuryAccountDTO> {
    const stripe = await this.client();
    const account = await withStripeErrors(() =>
      stripe.treasury.financialAccounts.retrieve(providerAccountId, {}, this.requestOptions()),
    );
    return toStripeTreasuryAccountDTO(account);
  }
}
