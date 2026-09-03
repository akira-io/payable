import { PayableError } from '../../../domain/errors/payable-error';
import { toTmtPayableError, withTmtErrors } from './trust-my-travel-errors';

const TRUST_MY_TRAVEL_BASE_URL = 'https://tmtprotects.com';

export interface TrustMyTravelClientOptions {
  path: string;
  apiToken: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TrustMyTravelRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export type TrustMyTravelRequest = <T>(
  path: string,
  options: TrustMyTravelRequestOptions,
) => Promise<T>;

export class TrustMyTravelClient {
  constructor(private readonly options: TrustMyTravelClientOptions) {}

  get sitePath(): string {
    return trimBoundarySlashes(this.options.path, true, true);
  }

  async cardVaultToken(): Promise<string> {
    return withTmtErrors(async () => {
      const baseUrl = trimBoundarySlashes(
        this.options.baseUrl ?? TRUST_MY_TRAVEL_BASE_URL,
        false,
        true,
      );
      const response = await this.fetch(
        `${baseUrl}/${this.sitePath}/wp-json/jwt-auth/v1/token/cardvaultuser`,
        { method: 'GET', headers: this.headers(false) },
      );
      const body = await parseResponseBody(response);
      if (!response.ok) throw toTmtPayableError(response.status, body);
      const token = (body as { token?: unknown } | null)?.token;
      if (typeof token !== 'string' || token.length === 0) {
        throw new PayableError('Trust My Travel card vault token response is invalid', {
          code: 'PROVIDER_TMT_CARD_VAULT_TOKEN_INVALID',
          context: { provider: 'trust-my-travel' },
        });
      }
      return token;
    });
  }

  request<T>(path: string, options: TrustMyTravelRequestOptions): Promise<T> {
    return withTmtErrors(async () => {
      const response = await this.fetch(this.url(path), {
        method: options.method,
        headers: this.headers(options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const body = await parseResponseBody(response);

      if (!response.ok) {
        throw toTmtPayableError(response.status, body);
      }

      return body as T;
    });
  }

  private headers(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.options.apiToken}`,
    };

    if (hasBody) {
      headers['content-type'] = 'application/json';
    }

    return headers;
  }

  private url(resourcePath: string): string {
    const baseUrl = trimBoundarySlashes(
      this.options.baseUrl ?? TRUST_MY_TRAVEL_BASE_URL,
      false,
      true,
    );
    const sitePath = trimBoundarySlashes(this.options.path, true, true);
    const endpoint = trimBoundarySlashes(resourcePath, true, false);
    return `${baseUrl}/${sitePath}/wp-json/tmt/v2/${endpoint}`;
  }

  private fetch(input: string | URL, init: RequestInit): Promise<Response> {
    const request = this.options.fetch ?? globalThis.fetch;

    if (!request) {
      throw new PayableError('No fetch implementation available for Trust My Travel', {
        code: 'PROVIDER_HTTP_CLIENT_UNAVAILABLE',
        context: { provider: 'trust-my-travel' },
      });
    }

    return request(input, init);
  }
}

function trimBoundarySlashes(value: string, trimLeading: boolean, trimTrailing: boolean): string {
  let start = 0;
  let end = value.length;

  while (trimLeading && start < end && value[start] === '/') {
    start += 1;
  }

  while (trimTrailing && end > start && value[end - 1] === '/') {
    end -= 1;
  }

  return start === 0 && end === value.length ? value : value.slice(start, end);
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
