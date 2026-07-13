import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../../domain/dtos/customer.dto';
import { withStripeErrors } from './stripe-errors';
import { toCustomerDTO } from './stripe-mappers';

export class StripeCustomers {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.client();
    const customer = await withStripeErrors(() =>
      stripe.customers.create(
        { email: input.email, name: input.name, metadata: input.metadata },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toCustomerDTO(customer);
  }

  async update(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    const stripe = await this.client();
    const customer = await withStripeErrors(() =>
      stripe.customers.update(
        input.providerCustomerId,
        { email: input.email, name: input.name, metadata: input.metadata },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toCustomerDTO(customer);
  }
}
