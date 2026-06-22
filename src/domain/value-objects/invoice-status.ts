export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'uncollectible', 'void'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isPaidInvoice(status: InvoiceStatus): boolean {
  return status === 'paid';
}
