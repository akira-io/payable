import { isCustomerCapable } from '../../domain/contracts/payment-provider.contract';
import type { Customer } from '../../domain/entities/customer.entity';
import { CustomerNotFoundError } from '../../domain/errors/customer-not-found.error';
import { PayableError } from '../../domain/errors/payable-error';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { Email } from '../../domain/value-objects/email';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
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
    const storage = this.requireStorage();
    if (this.deps.provider.capabilities().has('customers')) {
      await new SyncCustomerWithProviderAction(this.deps).handle(billable);
    } else {
      await this.upsertLocalCustomer(billable);
    }
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
    if (provider.capabilities().has('customers') && existing.providerCustomerId) {
      assertCapableProvider(provider, 'customers', isCustomerCapable);
      const key = IdempotencyKey.forCustomer({
        tenantId,
        provider: this.deps.providerName,
        billableType: billable.billableType,
        billableId: billable.billableId,
      });
      const dto = await provider.updateCustomer(
        {
          providerCustomerId: existing.providerCustomerId,
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

  private async upsertLocalCustomer(billable: Billable): Promise<void> {
    const storage = this.requireStorage();
    const tenantId = this.deps.tenantId ?? null;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (existing) {
      return;
    }
    await storage.customers.create({
      tenantId,
      provider: this.deps.providerName,
      providerCustomerId: null,
      billableType: billable.billableType,
      billableId: billable.billableId,
      email: this.normalizeEmail(billable.email),
      name: billable.name ?? null,
      metadata: null,
    });
  }

  private normalizeEmail(value: string | undefined): string {
    try {
      return Email.of(value ?? '').toString();
    } catch {
      throw new PayableError(`Invalid customer email: ${value}`, {
        code: 'CUSTOMER_EMAIL_INVALID',
        context: { billableEmail: value },
      });
    }
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
