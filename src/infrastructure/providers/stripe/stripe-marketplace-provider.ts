import type Stripe from 'stripe';
import type {
  MarketplaceAccountCapable,
  MarketplaceOnboardingCapable,
  MarketplacePayoutCapable,
  MarketplaceProvider,
  MarketplaceTransferCapable,
} from '../../../domain/contracts/marketplace-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateMarketplaceAccountInput,
  CreateMarketplaceOnboardingLinkInput,
  CreateMarketplacePayoutInput,
  CreateMarketplaceTransferInput,
  ListMarketplaceAccountsInput,
  ListMarketplacePayoutsInput,
  ListMarketplaceTransfersInput,
  MarketplaceAccountDTO,
  MarketplaceCapabilities,
  MarketplaceOnboardingLinkDTO,
  MarketplacePayoutDTO,
  MarketplaceTransferDTO,
} from '../../../domain/dtos/marketplace.dto';
import { stripeAmount } from './stripe-amounts';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import { collectFilteredStripeItems } from './stripe-filtered-list';
import {
  mapStripeMarketplaceAccount,
  mapStripeMarketplacePayout,
  mapStripeMarketplaceTransfer,
  stripeMarketplaceAccountParams,
} from './stripe-marketplace-mappers';

const DEFAULT_LIST_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export interface StripeMarketplaceProviderOptions {
  secretKey: string;
}

export class StripeMarketplaceProvider
  implements
    MarketplaceProvider,
    MarketplaceAccountCapable,
    MarketplaceOnboardingCapable,
    MarketplaceTransferCapable,
    MarketplacePayoutCapable
{
  readonly name = 'stripe-connect';
  private client?: Stripe;

  constructor(
    private readonly options: StripeMarketplaceProviderOptions,
    client?: unknown,
  ) {
    this.client = client as Stripe | undefined;
  }

  capabilities(): MarketplaceCapabilities {
    return new Set(['accounts', 'onboarding', 'transfers', 'payouts']);
  }

  async createMarketplaceAccount(
    input: CreateMarketplaceAccountInput,
    ctx: OperationContext,
  ): Promise<MarketplaceAccountDTO> {
    const stripe = await this.stripe();
    const account = await withStripeErrors(
      () => stripe.accounts.create(stripeMarketplaceAccountParams(input), this.idempotency(ctx)),
      this.name,
    );
    return mapStripeMarketplaceAccount(account);
  }

  async retrieveMarketplaceAccount(providerAccountId: string): Promise<MarketplaceAccountDTO> {
    const stripe = await this.stripe();
    const account = await withStripeErrors(
      () => stripe.accounts.retrieve(providerAccountId),
      this.name,
    );
    return mapStripeMarketplaceAccount(account);
  }

  async listMarketplaceAccounts(
    input: ListMarketplaceAccountsInput = {},
  ): Promise<MarketplaceAccountDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const accounts = await withStripeErrors(
      () =>
        collectFilteredStripeItems(
          stripe.accounts.list({ limit: Math.min(limit, STRIPE_PAGE_LIMIT) }),
          (account) =>
            !input.status || mapStripeMarketplaceAccount(account).status === input.status,
          limit,
        ),
      this.name,
    );
    return accounts.map(mapStripeMarketplaceAccount);
  }

  async createMarketplaceOnboardingLink(
    input: CreateMarketplaceOnboardingLinkInput,
    ctx: OperationContext,
  ): Promise<MarketplaceOnboardingLinkDTO> {
    const stripe = await this.stripe();
    const link = await withStripeErrors(
      () =>
        stripe.accountLinks.create(
          {
            account: input.providerAccountId,
            refresh_url: input.refreshUrl,
            return_url: input.returnUrl,
            type: 'account_onboarding',
          },
          this.idempotency(ctx),
        ),
      this.name,
    );
    return {
      providerAccountId: input.providerAccountId,
      url: link.url,
      expiresAt: link.expires_at ? new Date(link.expires_at * 1000) : null,
    };
  }

  async createMarketplaceTransfer(
    input: CreateMarketplaceTransferInput,
    ctx: OperationContext,
  ): Promise<MarketplaceTransferDTO> {
    const stripe = await this.stripe();
    const transfer = await withStripeErrors(
      () =>
        stripe.transfers.create(
          {
            amount: stripeAmount(input.amount),
            currency: input.amount.currency().toLowerCase(),
            destination: input.destinationProviderAccountId,
            metadata: input.reference ? { reference: input.reference } : undefined,
          },
          this.idempotency(ctx),
        ),
      this.name,
    );
    return mapStripeMarketplaceTransfer(transfer);
  }

  async listMarketplaceTransfers(
    input: ListMarketplaceTransfersInput = {},
  ): Promise<MarketplaceTransferDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const transfers = await withStripeErrors(
      () =>
        stripe.transfers
          .list({
            destination: input.destinationProviderAccountId,
            limit: Math.min(limit, STRIPE_PAGE_LIMIT),
          })
          .autoPagingToArray({ limit }),
      this.name,
    );
    return transfers.map(mapStripeMarketplaceTransfer);
  }

  async retrieveMarketplaceTransfer(providerTransferId: string): Promise<MarketplaceTransferDTO> {
    const stripe = await this.stripe();
    const transfer = await withStripeErrors(
      () => stripe.transfers.retrieve(providerTransferId),
      this.name,
    );
    return mapStripeMarketplaceTransfer(transfer);
  }

  async createMarketplacePayout(
    input: CreateMarketplacePayoutInput,
    ctx: OperationContext,
  ): Promise<MarketplacePayoutDTO> {
    const stripe = await this.stripe();
    const payout = await withStripeErrors(
      () =>
        stripe.payouts.create(
          {
            amount: stripeAmount(input.amount),
            currency: input.amount.currency().toLowerCase(),
            metadata: input.reference ? { reference: input.reference } : undefined,
          },
          { ...this.idempotency(ctx), stripeAccount: input.providerAccountId },
        ),
      this.name,
    );
    return mapStripeMarketplacePayout(payout, input.providerAccountId);
  }

  async listMarketplacePayouts(
    input: ListMarketplacePayoutsInput,
  ): Promise<MarketplacePayoutDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const payouts = await withStripeErrors(
      () =>
        stripe.payouts
          .list(
            { limit: Math.min(limit, STRIPE_PAGE_LIMIT) },
            { stripeAccount: input.providerAccountId },
          )
          .autoPagingToArray({ limit }),
      this.name,
    );
    return payouts.map((payout) => mapStripeMarketplacePayout(payout, input.providerAccountId));
  }

  async retrieveMarketplacePayout(
    providerAccountId: string,
    providerPayoutId: string,
  ): Promise<MarketplacePayoutDTO> {
    const stripe = await this.stripe();
    const payout = await withStripeErrors(
      () => stripe.payouts.retrieve(providerPayoutId, {}, { stripeAccount: providerAccountId }),
      this.name,
    );
    return mapStripeMarketplacePayout(payout, providerAccountId);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeMarketplaceProvider { name: '${this.name}' }`;
  }

  private idempotency(ctx: OperationContext): Stripe.RequestOptions {
    return { idempotencyKey: ctx.idempotencyKey };
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }
}
