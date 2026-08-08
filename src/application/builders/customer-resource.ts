import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { Customer } from '../../domain/entities/customer.entity';
import type { CustomerProviderBinding } from '../../domain/entities/customer-provider-binding.entity';
import type { CustomerProviderSyncState } from '../../domain/entities/customer-provider-sync-state.entity';
import { CustomerNotFoundError } from '../../domain/errors/customer-not-found.error';
import { PayableError } from '../../domain/errors/payable-error';
import { EnsureCustomerAction } from '../actions/customers/ensure-customer.action';
import { normalizeCustomerEmail } from '../actions/customers/normalize-customer-email';
import { SyncCustomerWithProviderAction } from '../actions/customers/sync-customer-with-provider.action';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

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
  id: string;
  provider: string;
  providerCustomerId: string;
}

export type CustomerPageItem = Customer & { bindings?: CustomerBindingMetadata[] };

export type CustomerPage = CollectionPage<CustomerPageItem>;

export interface CustomerResourceAccess {
  storage?: BillingDependencies['storage'];
  tenantId: string | null;
  providerName?: string;
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
            providerName: dependencies.providerName,
            resolveBillingDependencies: () => dependencies,
          }
        : dependencies;
  }

  async create(billable: Billable): Promise<Customer> {
    return new EnsureCustomerAction({
      storage: this.access.storage,
      tenantId: this.access.tenantId,
    }).handle(billable);
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
    const limit = normalizeCollectionLimit(input.limit);
    const filters = {
      id: input.id,
      billableType: input.billableType,
      billableId: input.billableId,
      email: normalizeSearch(input.email),
      name: normalizeSearch(input.name),
      includeBindings: input.includeBindings ?? false,
    };
    const context = {
      resource: 'customers',
      tenantId: this.access.tenantId,
      filters,
    };
    const page = await listCustomers.call(
      storage.customers,
      {
        limit,
        before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
        id: filters.id,
        billableType: filters.billableType,
        billableId: filters.billableId,
        email: filters.email,
        name: filters.name,
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
          ? encodeCollectionCursor(
              { createdAt: lastCustomer.createdAt, id: lastCustomer.id },
              context,
            )
          : null,
    };
  }

  async binding(billable: Billable): Promise<CustomerProviderBinding | null> {
    const storage = this.requireStorage();
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
      this.requireProviderName(),
      tenantId,
    );
  }

  sync(billable: Billable): Promise<string> {
    this.requireProviderName();
    return new SyncCustomerWithProviderAction(this.billingDependencies()).handle(billable);
  }

  async syncState(billable: Billable): Promise<CustomerProviderSyncState | null> {
    const storage = this.requireStorage();
    const tenantId = this.access.tenantId;
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (!customer) {
      return null;
    }
    return (
      storage.customerProviderSyncStates?.findByCustomerAndProvider(
        customer.id,
        this.requireProviderName(),
        tenantId,
      ) ?? null
    );
  }

  async update(billable: Billable, changes: CustomerChanges): Promise<Customer> {
    const storage = this.requireStorage();
    const tenantId = this.access.tenantId;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (!existing) {
      throw new CustomerNotFoundError(billable.billableId);
    }
    return storage.customers.update(
      existing.id,
      {
        email: changes.email === undefined ? existing.email : normalizeCustomerEmail(changes.email),
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

  private requireProviderName(): string {
    const providerName = this.access.providerName;
    if (!providerName) {
      throw new PayableError('Customer provider name is required', {
        code: 'CUSTOMER_PROVIDER_REQUIRED',
      });
    }
    return providerName;
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
        id: binding.id,
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

function normalizeSearch(value?: string): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase('en-US');
  return normalized ? normalized : undefined;
}
