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
import { decodeCustomerCursor, encodeCustomerCursor } from './customer-page-cursor';

const DEFAULT_CUSTOMER_LIMIT = 25;
const MAX_CUSTOMER_LIMIT = 100;

export interface CustomerChanges {
  email?: string;
  name?: string;
}

export interface ListCustomersInput {
  limit?: number;
  cursor?: string;
  id?: string;
  billableType?: string;
  billableId?: string;
  email?: string;
  name?: string;
  includeBindings?: boolean;
}

export interface CustomerBindingMetadata {
  provider: string;
  providerCustomerId: string;
}

export type CustomerPageItem = Customer & { bindings?: CustomerBindingMetadata[] };

export interface CustomerPage {
  items: CustomerPageItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CustomerResourceAccess {
  storage?: BillingDependencies['storage'];
  tenantId: string | null;
  resolveBillingDependencies: () => BillingDependencies;
}

export class CustomerResource {
  private readonly access: CustomerResourceAccess;

  constructor(dependencies: BillingDependencies | CustomerResourceAccess) {
    this.access =
      'provider' in dependencies
        ? {
            storage: dependencies.storage,
            tenantId: dependencies.tenantId ?? null,
            resolveBillingDependencies: () => dependencies,
          }
        : dependencies;
  }

  async create(billable: Billable): Promise<Customer> {
    const dependencies = this.billingDependencies();
    const customer = await new EnsureCustomerAction(dependencies).handle(billable);
    if (dependencies.provider.capabilities().has('customers')) {
      await new SyncCustomerWithProviderAction(dependencies).handle(billable);
    }
    return customer;
  }

  get(billable: Billable): Promise<Customer | null> {
    return this.requireStorage().customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.access.tenantId,
    );
  }

  find(id: string): Promise<Customer | null> {
    return this.requireStorage().customers.findById(id, this.access.tenantId);
  }

  async list(input: ListCustomersInput = {}): Promise<CustomerPage> {
    const storage = this.requireStorage();
    const listCustomers = storage.customers.list;
    if (!listCustomers) {
      throw new PayableError('The customer repository does not support collection queries', {
        code: 'CUSTOMER_LIST_UNSUPPORTED',
      });
    }
    const limit = normalizeLimit(input.limit);
    const page = await listCustomers.call(
      storage.customers,
      {
        limit,
        before: input.cursor ? decodeCustomerCursor(input.cursor) : undefined,
        id: input.id,
        billableType: input.billableType,
        billableId: input.billableId,
        email: input.email,
        name: input.name,
      },
      this.access.tenantId,
    );
    const items = input.includeBindings
      ? await this.includeBindingMetadata(page.items)
      : page.items;
    const lastCustomer = page.items.at(-1);
    return {
      items,
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && lastCustomer
          ? encodeCustomerCursor({ createdAt: lastCustomer.createdAt, id: lastCustomer.id })
          : null,
    };
  }

  async binding(billable: Billable): Promise<CustomerProviderBinding | null> {
    const storage = this.requireStorage();
    const dependencies = this.billingDependencies();
    const tenantId = this.access.tenantId;
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
      dependencies.providerName,
      tenantId,
    );
  }

  async update(billable: Billable, changes: CustomerChanges): Promise<Customer> {
    const storage = this.requireStorage();
    const dependencies = this.billingDependencies();
    const tenantId = this.access.tenantId;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (!existing) {
      throw new CustomerNotFoundError(billable.billableId);
    }
    const provider = dependencies.provider;
    const binding = await storage.customerProviderBindings.findByCustomerAndProvider(
      existing.id,
      dependencies.providerName,
      tenantId,
    );
    if (provider.capabilities().has('customers') && binding) {
      assertCapableProvider(provider, 'customers', isCustomerCapable);
      const key = IdempotencyKey.forCustomer({
        tenantId,
        provider: dependencies.providerName,
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
    const storage = this.access.storage;
    if (!storage) {
      throw new PayableError('Customer management requires a storage driver', {
        code: 'CUSTOMER_STORAGE_REQUIRED',
      });
    }
    return storage;
  }

  private billingDependencies(): BillingDependencies {
    return this.access.resolveBillingDependencies();
  }

  private async includeBindingMetadata(customers: Customer[]): Promise<CustomerPageItem[]> {
    const repository = this.requireStorage().customerProviderBindings;
    const listBindings = repository.listByCustomerIds;
    if (!listBindings) {
      throw new PayableError(
        'The customer binding repository does not support collection queries',
        {
          code: 'CUSTOMER_BINDING_LIST_UNSUPPORTED',
        },
      );
    }
    const bindings = await listBindings.call(
      repository,
      customers.map(({ id }) => id),
      this.access.tenantId,
    );
    const bindingsByCustomer = new Map<string, CustomerBindingMetadata[]>();
    for (const binding of bindings) {
      const customerBindings = bindingsByCustomer.get(binding.customerId) ?? [];
      customerBindings.push({
        provider: binding.provider,
        providerCustomerId: binding.providerCustomerId,
      });
      bindingsByCustomer.set(binding.customerId, customerBindings);
    }
    return customers.map((customer) => ({
      ...customer,
      bindings: bindingsByCustomer.get(customer.id) ?? [],
    }));
  }
}

function normalizeLimit(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_CUSTOMER_LIMIT;
  }
  return Math.min(Math.floor(requested), MAX_CUSTOMER_LIMIT);
}
