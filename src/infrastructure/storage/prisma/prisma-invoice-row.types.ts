export interface PrismaCanonicalInvoiceRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  customerId: string;
  subscriptionId: string | null;
  status: string;
  currency: string;
  total: bigint;
  amountPaid: bigint;
  amountDue: bigint;
  number: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaInvoiceRow {
  id: string;
  tenantId: string | null;
  customerId: string;
  subscriptionId: string | null;
  provider: string;
  providerInvoiceId: string | null;
  status: string;
  currency: string;
  total: bigint;
  amountPaid: bigint;
  amountDue: bigint;
  number: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaInvoiceProviderBindingRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  invoiceId: string;
  provider: string;
  providerResourceType: string;
  providerResourceId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaInvoicePaymentRow {
  tenantId: string | null;
  tenantKey: string;
  invoiceId: string;
  paymentId: string;
  createdAt: Date;
}
