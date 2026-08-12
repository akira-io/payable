import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { CanonicalInvoice } from '../../domain/entities/canonical-invoice.entity';
import type { InvoiceProviderBinding } from '../../domain/entities/invoice-provider-binding.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { InvoiceStateMachine } from '../../domain/states/invoice-state-machine';
import type { CurrencyCode } from '../../domain/value-objects/currency';
import type { InvoiceStatus } from '../../domain/value-objects/invoice-status';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../services/collections/normalize-collection-query';
import { isUniqueConstraintViolation } from '../services/storage/is-unique-constraint-violation';
import type { LocalDependencies } from './local-dependencies';

export interface CreateCanonicalInvoiceInput {
  customerId: string;
  subscriptionId?: string | null;
  status: InvoiceStatus;
  currency: CurrencyCode;
  total: number;
  amountPaid: number;
  amountDue: number;
  number?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
}

export interface AttachInvoiceProviderInput {
  provider: string;
  providerResourceType: string;
  providerResourceId: string;
}

export interface ListCanonicalInvoicesInput {
  limit?: number;
  cursor?: string;
  id?: string;
  customerId?: string;
  subscriptionId?: string;
  status?: InvoiceStatus;
  number?: string;
}

export type CanonicalInvoiceDetails = CanonicalInvoice & {
  bindings: InvoiceProviderBinding[];
  paymentIds: string[];
};

export class CanonicalInvoiceResource {
  constructor(private readonly dependencies: LocalDependencies) {}

  async create(input: CreateCanonicalInvoiceInput): Promise<CanonicalInvoice> {
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    if (!['draft', 'open', 'paid'].includes(input.status)) {
      throw new PayableError(`Invoice cannot be created in ${input.status}`, {
        code: 'INVOICE_INITIAL_STATUS_INVALID',
      });
    }
    const customer = await storage.customers.findById(input.customerId, tenantId);
    if (!customer) this.notFound('CUSTOMER_NOT_FOUND', 'Customer', input.customerId);
    if (input.subscriptionId) {
      const subscription = await storage.subscriptions.findById(input.subscriptionId, tenantId);
      if (!subscription)
        this.notFound('SUBSCRIPTION_NOT_FOUND', 'Subscription', input.subscriptionId);
      if (subscription.customerId !== input.customerId) {
        throw new PayableError('Subscription does not belong to the invoice customer', {
          code: 'INVOICE_SUBSCRIPTION_CUSTOMER_MISMATCH',
        });
      }
    }
    this.validateAmounts(input);
    return this.repository().create({
      tenantId,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId ?? null,
      status: input.status,
      currency: input.currency,
      total: input.total,
      amountPaid: input.amountPaid,
      amountDue: input.amountDue,
      number: input.number ?? null,
      hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
      invoicePdf: input.invoicePdf ?? null,
    });
  }

  async retrieve(id: string): Promise<CanonicalInvoiceDetails> {
    const invoice = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!invoice) this.notFound('INVOICE_NOT_FOUND', 'Invoice', id);
    return this.details(invoice);
  }

  async transition(id: string, target: InvoiceStatus): Promise<CanonicalInvoice> {
    const invoice = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!invoice) this.notFound('INVOICE_NOT_FOUND', 'Invoice', id);
    const machine = new InvoiceStateMachine(invoice.status);
    if (target === 'open') machine.finalize();
    if (target === 'paid') machine.pay();
    if (target === 'uncollectible') machine.markUncollectible();
    if (target === 'void') machine.voidInvoice();
    if (machine.current() === invoice.status) {
      throw new PayableError(`Invoice cannot transition from ${invoice.status} to ${target}`, {
        code: 'INVALID_STATE_TRANSITION',
      });
    }
    return this.repository().updateStatus(
      id,
      machine.current(),
      this.dependencies.tenantId ?? null,
    );
  }

  async list(
    input: ListCanonicalInvoicesInput = {},
  ): Promise<CollectionPage<CanonicalInvoiceDetails>> {
    const tenantId = this.dependencies.tenantId ?? null;
    const filters = {
      id: input.id,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      status: input.status,
      number: input.number,
    };
    const context = { resource: 'invoices', tenantId, filters };
    const page = await this.repository().list(
      {
        ...filters,
        limit: normalizeCollectionLimit(input.limit),
        before: input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined,
      },
      tenantId,
    );
    const last = page.items.at(-1);
    return {
      items: await this.pageDetails(page.items, tenantId),
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && last
          ? encodeCollectionCursor({ createdAt: last.createdAt, id: last.id }, context)
          : null,
    };
  }

  async attachProvider(
    id: string,
    input: AttachInvoiceProviderInput,
  ): Promise<InvoiceProviderBinding> {
    await this.retrieve(id);
    const repository = this.storage().invoiceProviderBindings;
    if (!repository) throw this.storageError();
    const tenantId = this.dependencies.tenantId ?? null;
    const existing = await repository.findByInvoiceAndProvider(id, input.provider, tenantId);
    if (existing) {
      if (
        existing.providerResourceType === input.providerResourceType &&
        existing.providerResourceId === input.providerResourceId
      )
        return existing;
      throw new PayableError('Invoice provider binding conflicts with the existing identity', {
        code: 'INVOICE_PROVIDER_BINDING_CONFLICT',
      });
    }
    try {
      return await repository.create({ tenantId, invoiceId: id, ...input });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const duplicate = await repository.findByInvoiceAndProvider(id, input.provider, tenantId);
      if (
        duplicate?.providerResourceType === input.providerResourceType &&
        duplicate.providerResourceId === input.providerResourceId
      ) {
        return duplicate;
      }
      const conflictingResource = await repository.findByProviderResource(
        input.provider,
        input.providerResourceType,
        input.providerResourceId,
        tenantId,
      );
      if (!conflictingResource) throw error;
      throw new PayableError('Invoice provider resource is already bound to another invoice', {
        code: 'INVOICE_PROVIDER_BINDING_CONFLICT',
      });
    }
  }

  async attachPayment(invoiceId: string, paymentId: string): Promise<void> {
    await this.retrieve(invoiceId);
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    const payment = await storage.payments.findById(paymentId, tenantId);
    if (!payment) this.notFound('PAYMENT_NOT_FOUND', 'Payment', paymentId);
    if (!storage.invoicePayments) throw this.storageError();
    await storage.invoicePayments.attach({
      tenantId,
      invoiceId,
      paymentId,
      createdAt: this.dependencies.clock.now(),
    });
  }

  async detachPayment(invoiceId: string, paymentId: string): Promise<void> {
    await this.retrieve(invoiceId);
    const repository = this.storage().invoicePayments;
    if (!repository) throw this.storageError();
    await repository.detach(invoiceId, paymentId, this.dependencies.tenantId ?? null);
  }

  private async details(invoice: CanonicalInvoice): Promise<CanonicalInvoiceDetails> {
    const storage = this.storage();
    if (!storage.invoiceProviderBindings || !storage.invoicePayments) throw this.storageError();
    const tenantId = this.dependencies.tenantId ?? null;
    const [bindings, payments] = await Promise.all([
      storage.invoiceProviderBindings.listByInvoiceId(invoice.id, tenantId),
      storage.invoicePayments.listByInvoiceId(invoice.id, tenantId),
    ]);
    return { ...invoice, bindings, paymentIds: payments.map(({ paymentId }) => paymentId) };
  }

  private async pageDetails(
    invoices: CanonicalInvoice[],
    tenantId: string | null,
  ): Promise<CanonicalInvoiceDetails[]> {
    const storage = this.storage();
    if (!storage.invoiceProviderBindings || !storage.invoicePayments) throw this.storageError();
    const invoiceIds = invoices.map(({ id }) => id);
    const [bindings, payments] = await Promise.all([
      storage.invoiceProviderBindings.listByInvoiceIds(invoiceIds, tenantId),
      storage.invoicePayments.listByInvoiceIds(invoiceIds, tenantId),
    ]);
    const bindingsByInvoice = this.groupByInvoice(bindings);
    const paymentsByInvoice = this.groupByInvoice(payments);
    return invoices.map((invoice) => ({
      ...invoice,
      bindings: bindingsByInvoice.get(invoice.id) ?? [],
      paymentIds: (paymentsByInvoice.get(invoice.id) ?? []).map(({ paymentId }) => paymentId),
    }));
  }

  private groupByInvoice<T extends { invoiceId: string }>(rows: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const invoiceRows = grouped.get(row.invoiceId) ?? [];
      invoiceRows.push(row);
      grouped.set(row.invoiceId, invoiceRows);
    }
    return grouped;
  }

  private repository() {
    const repository = this.storage().canonicalInvoices;
    if (!repository) throw this.storageError();
    return repository;
  }

  private storage() {
    const storage = this.dependencies.storage;
    if (!storage) throw this.storageError();
    return storage;
  }

  private storageError(): PayableError {
    return new PayableError('Canonical invoice management requires a storage driver', {
      code: 'INVOICE_STORAGE_REQUIRED',
    });
  }

  private notFound(code: string, resource: string, id: string): never {
    throw new PayableError(`${resource} not found: ${id}`, { code });
  }

  private validateAmounts(input: CreateCanonicalInvoiceInput): void {
    for (const amount of [input.total, input.amountPaid, input.amountDue]) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new PayableError('Invoice amounts must be non-negative safe integers', {
          code: 'INVOICE_AMOUNT_INVALID',
        });
      }
    }
    if (input.amountPaid + input.amountDue !== input.total) {
      throw new PayableError('Invoice paid and due amounts must equal total', {
        code: 'INVOICE_AMOUNT_INCONSISTENT',
      });
    }
  }
}
