import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevolutBusinessClient } from '../src/infrastructure/providers/revolut/revolut-business-client';
import { RevolutClient } from '../src/infrastructure/providers/revolut/revolut-client';
import { StripeInvoices } from '../src/infrastructure/providers/stripe/stripe-invoices';

const neverResolvingFetch = ((_url: string | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })) as typeof globalThis.fetch;

function chunkedResponse(chunks: Uint8Array[], onCancel: () => void): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      index += 1;
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, { status: 200 });
}

function stripeWithPdf(url: string): () => Promise<Stripe> {
  const stripe = {
    invoices: { retrieve: async () => ({ id: 'in_1', invoice_pdf: url }) },
  } as unknown as Stripe;
  return async () => stripe;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider HTTP bounds', () => {
  it('times out a Revolut merchant request that never resolves', async () => {
    const client = new RevolutClient({
      secretKey: 'sk',
      fetch: neverResolvingFetch,
      timeoutMs: 20,
    });

    await expect(client.request('/api/orders', { method: 'GET' })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_TIMEOUT',
    });
  });

  it('times out a Revolut business request that never resolves', async () => {
    const client = new RevolutBusinessClient({
      tokenProvider: { getAccessToken: () => 'token' },
      fetch: neverResolvingFetch,
      timeoutMs: 20,
    });

    await expect(client.request('/accounts', { method: 'GET' })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_TIMEOUT',
    });
  });

  it('stops reading a chunked invoice PDF without content-length at the size limit', async () => {
    let cancelled = false;
    const oversized = new Uint8Array(1024 * 1024).fill(37);
    const chunks = Array.from({ length: 20 }, () => oversized);
    vi.stubGlobal('fetch', async () =>
      chunkedResponse(chunks, () => {
        cancelled = true;
      }),
    );

    const invoices = new StripeInvoices(stripeWithPdf('https://files.stripe.test/in_1.pdf'));

    await expect(invoices.downloadPdf('in_1')).rejects.toMatchObject({
      code: 'INVOICE_PDF_TOO_LARGE',
    });
    expect(cancelled).toBe(true);
  });

  it('assembles a chunked invoice PDF under the limit', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    vi.stubGlobal('fetch', async () => chunkedResponse(chunks, () => {}));

    const invoices = new StripeInvoices(stripeWithPdf('https://files.stripe.test/in_1.pdf'));
    const pdf = await invoices.downloadPdf('in_1');

    expect(pdf.filename).toBe('in_1.pdf');
    expect(Array.from(pdf.content)).toEqual([1, 2, 3, 4, 5]);
  });
});
