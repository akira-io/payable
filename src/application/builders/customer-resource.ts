import { isCustomerCapable } from '../../domain/contracts/payment-provider.contract';
import type { Customer } from '../../domain/entities/customer.entity';
import type { CustomerProviderBinding } from '../../domain/entities/customer-provider-binding.entity';
import { CustomerNotFoundError } from '../../domain/errors/customer-not-found.error';
import { PayableError } from '../../domain/errors/payable-error';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import { EnsureCustomerAction } from '../actions/customers/ensure-customer.action';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export interface CustomerChanges {
  email?: string;
  name?: string;
}

export class CustomerResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(billable: Billable): Promise<Customer> {
    const customer = await new EnsureCustomerAction(this.deps).handle(billable);
    if (this.deps.provider.capabilities().has('customers')) {
      await new SyncCustomerWithProviderAction(this.deps).handle(billable);
    }
    return customer;
  }

  get(billable: Billable): Promise<Customer | null> {
    return this.requireStorage().customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
  }

  async binding(billable: Billable): Promise<CustomerProviderBinding | null> {
    const storage = this.requireStorage();
    const tenantId = this.deps.tenantId ?? null;
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (!customer) {
      return null;
    }
    return storage.customerProviderBindings.findByCustomerAndProvider(
      customer.id,
      this.deps.providerName,
      tenantId,
    );
  }

  async update(billable: Billable, changes: CustomerChanges): Promise<Customer> {
    const storage = this.requireStorage();
    const tenantId = this.deps.tenantId ?? null;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (!existing) {
      throw new CustomerNotFoundError(billable.billableId);
    }
    const provider = this.deps.provider;
    const binding = await storage.customerProviderBindings.findByCustomerAndProvider(
      existing.id,
      this.deps.providerName,
      tenantId,
    );
    if (provider.capabilities().has('customers') && binding) {
      assertCapableProvider(provider, 'customers', isCustomerCapable);
      const key = IdempotencyKey.forCustomer({
        tenantId,
        provider: this.deps.providerName,
        billableType: billable.billableType,
        billableId: billable.billableId,
      });
      const dto = await provider.updateCustomer(
        {
          providerCustomerId: binding.providerCustomerId,
          email: changes.email,
          name: changes.name,
        },
        { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
      );
      return storage.customers.update(
        existing.id,
        {
          email: dto.email ?? changes.email ?? existing.email,
          name: dto.name ?? changes.name ?? existing.name,
        },
        tenantId,
      );
    }
    return storage.customers.update(
      existing.id,
      {
        email: changes.email ?? existing.email,
        name: changes.name ?? existing.name,
      },
      tenantId,
    );
  }

  private requireStorage(): NonNullable<BillingDependencies['storage']> {
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Customer management requires a storage driver', {
        code: 'CUSTOMER_STORAGE_REQUIRED',
      });
    }
    return storage;
  }
}
