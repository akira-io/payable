import type { Customer } from '../../../domain/entities/customer.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { normalizeCustomerEmail } from './normalize-customer-email';

export class EnsureCustomerAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable): Promise<Customer> {
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Customer management requires a storage driver', {
        code: 'CUSTOMER_STORAGE_REQUIRED',
      });
    }
    const tenantId = this.deps.tenantId ?? null;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (existing) {
      return existing;
    }
    try {
      return await storage.customers.create({
        tenantId,
        billableType: billable.billableType,
        billableId: billable.billableId,
        email: normalizeCustomerEmail(billable.email),
        name: billable.name ?? null,
        metadata: null,
      });
    } catch (error) {
      const raced = await storage.customers.findByBillable(
        billable.billableType,
        billable.billableId,
        tenantId,
      );
      if (raced) {
        return raced;
      }
      throw error;
    }
  }
}
