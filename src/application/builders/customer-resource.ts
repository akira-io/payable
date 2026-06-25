import type { Customer } from '../../domain/entities/customer.entity';
import { CustomerNotFoundError } from '../../domain/errors/customer-not-found.error';
import { PayableError } from '../../domain/errors/payable-error';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import { assertProviderCapability } from '../services/provider-capabilities/assert-provider-capability';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export interface CustomerChanges {
  email?: string;
  name?: string;
}

export class CustomerResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(billable: Billable): Promise<Customer> {
    assertProviderCapability(this.deps.provider, 'customers');
    const storage = this.requireStorage();
    await new SyncCustomerWithProviderAction(this.deps).handle(billable);
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!customer) {
      throw new CustomerNotFoundError(billable.billableId);
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

  async update(billable: Billable, changes: CustomerChanges): Promise<Customer> {
    assertProviderCapability(this.deps.provider, 'customers');
    const storage = this.requireStorage();
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!existing?.providerCustomerId) {
      throw new CustomerNotFoundError(billable.billableId);
    }
    const key = IdempotencyKey.forCustomer({
      tenantId: this.deps.tenantId ?? null,
      provider: this.deps.providerName,
      billableType: billable.billableType,
      billableId: billable.billableId,
    });
    const dto = await this.deps.provider.updateCustomer(
      { providerCustomerId: existing.providerCustomerId, email: changes.email, name: changes.name },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
    );
    return storage.customers.update(existing.id, {
      email: dto.email ?? changes.email ?? existing.email,
      name: dto.name ?? changes.name ?? existing.name,
    });
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
