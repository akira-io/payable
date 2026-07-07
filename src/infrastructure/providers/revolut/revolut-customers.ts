import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../../domain/dtos/customer.dto';
import { toRevolutCustomerDTO } from './revolut-mappers';
import type {
  RevolutCustomer,
  RevolutCustomerCreationPayload,
  RevolutCustomerUpdatePayload,
  RevolutRequest,
} from './revolut-types';

export class RevolutCustomers {
  constructor(private readonly request: RevolutRequest) {}

  async create(input: CreateCustomerInput, _ctx: OperationContext): Promise<CustomerDTO> {
    const body: RevolutCustomerCreationPayload = {
      email: input.email,
      full_name: input.name,
    };
    const customer = await this.request<RevolutCustomer>('/api/customers', {
      method: 'POST',
      body,
    });
    return toRevolutCustomerDTO(customer);
  }

  async update(input: UpdateCustomerInput, _ctx: OperationContext): Promise<CustomerDTO> {
    const body: RevolutCustomerUpdatePayload = {
      email: input.email,
      full_name: input.name,
    };
    const customer = await this.request<RevolutCustomer>(
      `/api/customers/${encodeURIComponent(input.providerCustomerId)}`,
      { method: 'PATCH', body },
    );
    return toRevolutCustomerDTO(customer);
  }
}
