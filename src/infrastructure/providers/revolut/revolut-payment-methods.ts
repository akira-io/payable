import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  DeletePaymentMethodInput,
  ListPaymentMethodsInput,
  PaymentMethodDTO,
} from '../../../domain/dtos/payment-method.dto';
import { toRevolutPaymentMethodDTO } from './revolut-mappers';
import type { RevolutCustomerPaymentMethods, RevolutRequest } from './revolut-types';

const DEFAULT_PAYMENT_METHOD_LIMIT = 100;

export class RevolutPaymentMethods {
  constructor(private readonly request: RevolutRequest) {}

  async list(input: ListPaymentMethodsInput): Promise<PaymentMethodDTO[]> {
    const response = await this.request<RevolutCustomerPaymentMethods>(
      `/api/customers/${encodeURIComponent(input.providerCustomerId)}/payment-methods`,
      { method: 'GET' },
    );
    const limit = Math.max(0, input.limit ?? DEFAULT_PAYMENT_METHOD_LIMIT);
    return response.payment_methods
      .slice(0, limit)
      .map((method) => toRevolutPaymentMethodDTO(method, input.providerCustomerId));
  }

  async delete(input: DeletePaymentMethodInput, _ctx: OperationContext): Promise<void> {
    await this.request<void>(
      `/api/customers/${encodeURIComponent(input.providerCustomerId)}/payment-methods/${encodeURIComponent(input.providerPaymentMethodId)}`,
      { method: 'DELETE' },
    );
  }
}
