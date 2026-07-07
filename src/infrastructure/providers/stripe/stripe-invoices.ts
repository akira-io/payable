import type Stripe from 'stripe';
import type {
  InvoiceDTO,
  InvoicePdfDTO,
  ListInvoicesInput,
} from '../../../domain/dtos/invoice.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { withStripeErrors } from './stripe-errors';
import { toInvoiceDTO } from './stripe-mappers';

const DEFAULT_INVOICE_LIMIT = 100;
const INVOICE_PDF_TIMEOUT_MS = 10_000;
const INVOICE_PDF_MAX_BYTES = 10 * 1024 * 1024;

export class StripeInvoices {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async list(input: ListInvoicesInput): Promise<InvoiceDTO[]> {
    const stripe = await this.client();
    const cap = input.limit ?? DEFAULT_INVOICE_LIMIT;
    const invoices = await withStripeErrors(() =>
      stripe.invoices
        .list({ customer: input.providerCustomerId, limit: Math.min(cap, 100) })
        .autoPagingToArray({ limit: cap }),
    );
    return invoices.map(toInvoiceDTO);
  }

  async downloadPdf(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    const stripe = await this.client();
    const invoice = await withStripeErrors(() => stripe.invoices.retrieve(providerInvoiceId));
    if (!invoice.invoice_pdf) {
      throw new PayableError(`Invoice ${providerInvoiceId} has no PDF`, {
        code: 'INVOICE_PDF_UNAVAILABLE',
      });
    }
    if (!invoice.invoice_pdf.startsWith('https://')) {
      throw new PayableError(`Invoice ${providerInvoiceId} PDF URL is not https`, {
        code: 'INVOICE_PDF_UNTRUSTED_URL',
      });
    }
    const response = await downloadInvoicePdfResponse(providerInvoiceId, invoice.invoice_pdf);
    const declaredLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > INVOICE_PDF_MAX_BYTES) {
      throw new PayableError(`Invoice ${providerInvoiceId} PDF exceeds the size limit`, {
        code: 'INVOICE_PDF_TOO_LARGE',
        context: { bytes: declaredLength },
      });
    }
    const buffer = await readInvoicePdfBuffer(providerInvoiceId, response);
    if (buffer.byteLength > INVOICE_PDF_MAX_BYTES) {
      throw new PayableError(`Invoice ${providerInvoiceId} PDF exceeds the size limit`, {
        code: 'INVOICE_PDF_TOO_LARGE',
        context: { bytes: buffer.byteLength },
      });
    }
    return { filename: `${providerInvoiceId}.pdf`, content: new Uint8Array(buffer) };
  }
}

async function downloadInvoicePdfResponse(
  providerInvoiceId: string,
  invoicePdf: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await globalThis.fetch(invoicePdf, {
      signal: AbortSignal.timeout(INVOICE_PDF_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new PayableError(`Failed to download invoice ${providerInvoiceId} PDF`, {
      code: 'INVOICE_PDF_DOWNLOAD_FAILED',
      context: { reason: timedOut ? 'timeout' : 'transport' },
      cause: error,
    });
  }
  if (!response.ok) {
    throw new PayableError(`Failed to download invoice ${providerInvoiceId} PDF`, {
      code: 'INVOICE_PDF_DOWNLOAD_FAILED',
      context: { status: response.status },
    });
  }
  return response;
}

async function readInvoicePdfBuffer(
  providerInvoiceId: string,
  response: Response,
): Promise<ArrayBuffer> {
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new PayableError(`Failed to read invoice ${providerInvoiceId} PDF`, {
      code: 'INVOICE_PDF_DOWNLOAD_FAILED',
      context: { reason: 'transport' },
      cause: error,
    });
  }
}
