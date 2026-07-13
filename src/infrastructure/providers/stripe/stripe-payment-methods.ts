import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  DeletePaymentMethodInput,
  ListPaymentMethodsInput,
  PaymentMethodDTO,
} from '../../../domain/dtos/payment-method.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripePaymentMethodDTO } from './stripe-mappers';

const DEFAULT_PAYMENT_METHOD_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripePaymentMethods {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async list(input: ListPaymentMethodsInput): Promise<PaymentMethodDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_PAYMENT_METHOD_LIMIT;
    const methods = await withStripeErrors(() =>
      stripe.customers
        .listPaymentMethods(input.providerCustomerId, {
          limit: Math.min(limit, STRIPE_PAGE_LIMIT),
        })
        .autoPagingToArray({ limit }),
    );
    return methods.map((method) => toStripePaymentMethodDTO(method, input.providerCustomerId));
  }

  async delete(input: DeletePaymentMethodInput, ctx: OperationContext): Promise<void> {
    const stripe = await this.client();
    await withStripeErrors(() =>
      stripe.customers.retrievePaymentMethod(
        input.providerCustomerId,
        input.providerPaymentMethodId,
      ),
    );
    await withStripeErrors(() =>
      stripe.paymentMethods.detach(
        input.providerPaymentMethodId,
        {},
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
  }
}
