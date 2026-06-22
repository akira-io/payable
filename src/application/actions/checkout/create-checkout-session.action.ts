import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export interface CreateCheckoutSessionRequest {
  input: CreateCheckoutSessionInput;
  idempotencyKey: string;
}

export class CreateCheckoutSessionAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(request: CreateCheckoutSessionRequest): Promise<CheckoutSessionDTO> {
    return this.deps.provider.createCheckoutSession(request.input, {
      correlationId: CorrelationId.generate().toString(),
      idempotencyKey: request.idempotencyKey,
    });
  }
}
