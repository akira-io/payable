import type { InvoiceDTO } from '../../domain/dtos/invoice.dto';
import { PayableError } from '../../domain/errors/payable-error';

export class InvoiceBuilder {
  private readonly state: { customerId?: string } = {};

  forCustomer(customerId: string): this {
    this.state.customerId = customerId;
    return this;
  }

  // TODO: Phase 10 - assemble and create an invoice.
  async create(): Promise<InvoiceDTO> {
    throw PayableError.notImplemented(
      `InvoiceBuilder.create (${this.state.customerId ?? 'no-customer'})`,
    );
  }
}
