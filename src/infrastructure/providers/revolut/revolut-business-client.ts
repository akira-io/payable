import { PayableError } from '../../../domain/errors/payable-error';
import type {
  RevolutBusinessEnvironment,
  RevolutBusinessFetch,
  RevolutBusinessRequestOptions,
} from './revolut-business-types';
import { revolutNetworkError, toRevolutPayableError } from './revolut-errors';

const PROVIDER = 'revolut-business-treasury';
const BASE_URL: Record<RevolutBusinessEnvironment, string> = {
  production: 'https://b2b.revolut.com/api/1.0',
  sandbox: 'https://sandbox-b2b.revolut.com/api/1.0',
};

export interface RevolutBusinessTokenProvider {
  getAccessToken(): string | Promise<string>;
}

export interface RevolutBusinessClientOptions {
  tokenProvider: RevolutBusinessTokenProvider;
  environment?: RevolutBusinessEnvironment;
  baseUrl?: string;
  fetch?: RevolutBusinessFetch;
}

export class RevolutBusinessClient {
  readonly environment: RevolutBusinessEnvironment;

  constructor(private readonly options: RevolutBusinessClientOptions) {
    this.environment = options.environment ?? 'production';
  }

  async request<T>(path: string, options: RevolutBusinessRequestOptions): Promise<T> {
    const accessToken = await this.accessToken();
    const response = await this.fetch(this.url(path), {
      method: options.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }).catch((error: unknown) => {
      throw revolutNetworkError(error, PROVIDER);
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw toRevolutPayableError(response.status, body, PROVIDER);
    }
    return body as T;
  }

  private async accessToken(): Promise<string> {
    let token: string;
    try {
      token = await this.options.tokenProvider.getAccessToken();
    } catch (error) {
      throw new PayableError('Unable to obtain a Revolut Business access token', {
        code: 'PROVIDER_AUTH_FAILED',
        context: { provider: PROVIDER },
        cause: error,
      });
    }
    if (!token.trim()) {
      throw new PayableError('Revolut Business access token cannot be empty', {
        code: 'PROVIDER_AUTH_FAILED',
        context: { provider: PROVIDER },
      });
    }
    return token;
  }

  private url(path: string): string {
    const baseUrl = this.options.baseUrl ?? BASE_URL[this.environment];
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const request = this.options.fetch ?? globalThis.fetch;
    if (!request) {
      throw new PayableError('No fetch implementation available for Revolut Business', {
        code: 'PROVIDER_HTTP_CLIENT_UNAVAILABLE',
        context: { provider: PROVIDER },
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
