import { PayableError } from '../../../domain/errors/payable-error';
import { revolutNetworkError, toRevolutPayableError } from './revolut-errors';
import type { RevolutEnvironment, RevolutFetch, RevolutRequestOptions } from './revolut-types';

export const REVOLUT_MERCHANT_API_VERSION = '2026-04-20' as const;

const REVOLUT_BASE_URL: Record<RevolutEnvironment, string> = {
  production: 'https://merchant.revolut.com',
  sandbox: 'https://sandbox-merchant.revolut.com',
};

export interface RevolutClientOptions {
  secretKey: string;
  providerName?: string;
  environment?: RevolutEnvironment;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: RevolutFetch;
}

export class RevolutClient {
  readonly environment: RevolutEnvironment;
  private readonly providerName: string;

  constructor(private readonly options: RevolutClientOptions) {
    this.environment = options.environment ?? 'production';
    this.providerName = options.providerName ?? 'revolut';
  }

  async request<T>(path: string, options: RevolutRequestOptions): Promise<T> {
    const response = await this.fetch(this.url(path), {
      method: options.method,
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }).catch((error: unknown) => {
      throw revolutNetworkError(error, this.providerName);
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw toRevolutPayableError(response.status, body, this.providerName);
    }
    return body as T;
  }

  private headers(options: RevolutRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.options.secretKey}`,
      'revolut-api-version': this.options.apiVersion ?? REVOLUT_MERCHANT_API_VERSION,
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    return headers;
  }

  private url(path: string): string {
    const baseUrl = this.options.baseUrl ?? REVOLUT_BASE_URL[this.environment];
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const request = this.options.fetch ?? globalThis.fetch;
    if (!request) {
      throw new PayableError('No fetch implementation available for RevolutProvider', {
        code: 'PROVIDER_HTTP_CLIENT_UNAVAILABLE',
        context: { provider: this.providerName },
      });
    }
    return request(input, init);
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
