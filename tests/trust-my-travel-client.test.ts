import { describe, expect, it } from 'vitest';
import { TrustMyTravelClient } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-client';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function recordFetch(response: Response) {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response;
  };
  return { fetch, requests };
}

describe('TrustMyTravelClient', () => {
  it('requests the site-scoped API with bearer authentication', async () => {
    const { fetch, requests } = recordFetch(
      Response.json({ id: 91, status: 'active' }, { status: 201 }),
    );
    const client = new TrustMyTravelClient({
      path: 'bu-country-tours',
      apiToken: 'tmt_secret_token',
      fetch,
    });

    const response = await client.request<{ id: number; status: string }>('/bookings', {
      method: 'POST',
      body: { total: 9999 },
    });

    expect(response).toEqual({ id: 91, status: 'active' });
    expect(requests).toEqual([
      {
        url: 'https://tmtprotects.com/bu-country-tours/wp-json/tmt/v2/bookings',
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer tmt_secret_token',
          'content-type': 'application/json',
        },
        body: { total: 9999 },
      },
    ]);
  });

  it('normalizes slashes for an overridden base URL and site path', async () => {
    const { fetch, requests } = recordFetch(Response.json({ id: 2452 }));
    const client = new TrustMyTravelClient({
      path: '/sandbox/',
      apiToken: 'token',
      baseUrl: 'https://tmt.test/',
      fetch,
    });

    await client.request('/channels/2452', { method: 'GET' });

    expect(requests[0]?.url).toBe('https://tmt.test/sandbox/wp-json/tmt/v2/channels/2452');
  });

  it('parses a successful empty response as null', async () => {
    const { fetch } = recordFetch(new Response(null, { status: 204 }));
    const client = new TrustMyTravelClient({ path: 'site', apiToken: 'token', fetch });

    await expect(client.request('/bookings/91', { method: 'DELETE' })).resolves.toBeNull();
  });
});
