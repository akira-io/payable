import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateTreasuryTransferInput,
  ListTreasuryTransfersInput,
  TreasuryTransferDTO,
} from '../../../domain/dtos/treasury.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount } from './stripe-amounts';
import { withStripeErrors } from './stripe-errors';
import {
  toStripeTreasuryOutboundPaymentDTO,
  toStripeTreasuryTransferDTO,
} from './stripe-treasury-mappers';

const DEFAULT_TRANSFER_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeTreasuryTransfers {
  constructor(
    private readonly client: () => Promise<Stripe>,
    private readonly requestOptions: () => Stripe.RequestOptions,
  ) {}

  async create(
    input: CreateTreasuryTransferInput,
    context: OperationContext,
  ): Promise<TreasuryTransferDTO> {
    const stripe = await this.client();
    const params = {
      amount: stripeAmount(input.amount),
      currency: input.amount.currency().toLowerCase(),
      financial_account: input.sourceProviderAccountId,
      description: input.reference,
    };
    const options = { ...this.requestOptions(), idempotencyKey: context.idempotencyKey };
    const destination = input.destination;
    if (destination.type === 'account') {
      const transfer = await withStripeErrors(() =>
        stripe.treasury.outboundTransfers.create(
          {
            ...params,
            destination_payment_method_data: {
              type: 'financial_account',
              financial_account: destination.providerAccountId,
            },
          },
          options,
        ),
      );
      return toStripeTreasuryTransferDTO(transfer);
    }
    if (destination.type === 'payment_method') {
      const payment = await withStripeErrors(() =>
        stripe.treasury.outboundPayments.create(
          {
            ...params,
            destination_payment_method: destination.providerPaymentMethodId,
          },
          options,
        ),
      );
      return toStripeTreasuryOutboundPaymentDTO(payment);
    }
    throw unsupportedDestination(destination.type);
  }

  async list(input: ListTreasuryTransfersInput): Promise<TreasuryTransferDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_TRANSFER_LIMIT;
    const params = {
      financial_account: input.providerAccountId,
      limit: Math.min(limit, STRIPE_PAGE_LIMIT),
    };
    const [transfers, payments] = await Promise.all([
      withStripeErrors(() =>
        stripe.treasury.outboundTransfers
          .list(params, this.requestOptions())
          .autoPagingToArray({ limit }),
      ),
      withStripeErrors(() =>
        stripe.treasury.outboundPayments
          .list(params, this.requestOptions())
          .autoPagingToArray({ limit }),
      ),
    ]);
    return [
      ...transfers.map(toStripeTreasuryTransferDTO),
      ...payments.map(toStripeTreasuryOutboundPaymentDTO),
    ]
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
      .slice(0, limit);
  }

  async retrieve(providerTransferId: string): Promise<TreasuryTransferDTO> {
    const stripe = await this.client();
    if (providerTransferId.startsWith('obp_')) {
      const payment = await withStripeErrors(() =>
        stripe.treasury.outboundPayments.retrieve(providerTransferId, {}, this.requestOptions()),
      );
      return toStripeTreasuryOutboundPaymentDTO(payment);
    }
    const transfer = await withStripeErrors(() =>
      stripe.treasury.outboundTransfers.retrieve(providerTransferId, {}, this.requestOptions()),
    );
    return toStripeTreasuryTransferDTO(transfer);
  }
}

function unsupportedDestination(destinationType: string): PayableError {
  return new PayableError('Stripe Treasury does not support counterparty transfer destinations', {
    code: 'PROVIDER_TREASURY_DESTINATION_UNSUPPORTED',
    context: { provider: 'stripe-treasury', destinationType },
  });
}
