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
    const run = (): Promise<CheckoutSessionDTO> =>
      this.deps.provider.createCheckoutSession(request.input, {
        correlationId: CorrelationId.generate().toString(),
        idempotencyKey: request.idempotencyKey,
      });
    if (!this.deps.idempotency) {
      return run();
    }
    return this.deps.idempotency.execute({
      key: request.idempotencyKey,
      scope: 'checkout',
      operation: 'checkout.session',
      request: request.input,
      resourceType: 'checkout_session',
      tenantId: this.deps.tenantId,
      retryFailed: true,
      run,
    });
  }
}
