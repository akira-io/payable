import type { CustomerProviderBindingRepository } from '../../../domain/contracts/customer-provider-binding-repository.contract';
import { CustomerProviderBindingConflictError } from '../../../domain/errors/customer-provider-binding-conflict.error';
import { CustomerProviderBindingPersistenceError } from '../../../domain/errors/customer-provider-binding-persistence.error';

export class CustomerProviderBindingWriter {
  constructor(
    private readonly repository: CustomerProviderBindingRepository,
    private readonly provider: string,
    private readonly tenantId: string | null,
  ) {}

  async persist(customerId: string, providerCustomerId: string): Promise<void> {
    try {
      await this.repository.create({ customerId, provider: this.provider, providerCustomerId });
    } catch (error) {
      const raced = await this.repository.findByCustomerAndProvider(
        customerId,
        this.provider,
        this.tenantId,
      );
      if (!raced) {
        throw new CustomerProviderBindingPersistenceError(this.provider, providerCustomerId, {
          cause: error,
        });
      }
      if (raced.providerCustomerId !== providerCustomerId) {
        throw new CustomerProviderBindingConflictError(
          this.provider,
          providerCustomerId,
          raced.providerCustomerId,
          { cause: error },
        );
      }
    }
  }
}
