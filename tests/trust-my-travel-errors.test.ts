import { describe, expect, it } from 'vitest';
import { TrustMyTravelClient } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-client';

const CODE_BY_STATUS = [
  [400, 'PROVIDER_REQUEST_INVALID'],
  [401, 'PROVIDER_AUTHENTICATION_FAILED'],
  [403, 'PROVIDER_AUTHENTICATION_FAILED'],
  [404, 'PROVIDER_RESOURCE_NOT_FOUND'],
  [429, 'PROVIDER_RATE_LIMITED'],
  [500, 'PROVIDER_UNAVAILABLE'],
  [504, 'PROVIDER_UNAVAILABLE'],
] as const;

describe('Trust My Travel errors', () => {
  it.each(
    CODE_BY_STATUS,
  )('maps HTTP %i to %s and preserves the response body', async (status, code) => {
    const body = { message: 'Provider rejected the request', reason: 'invalid-field' };
    const client = new TrustMyTravelClient({
      path: 'site',
      apiToken: 'tmt_secret_token',
      fetch: async () => Response.json(body, { status }),
    });

    await expect(client.request('/bookings', { method: 'GET' })).rejects.toMatchObject({
      code,
      context: { provider: 'trust-my-travel', status, body },
    });
  });

  it('does not expose the API token in normalized error details', async () => {
    const client = new TrustMyTravelClient({
      path: 'site',
      apiToken: 'tmt_secret_token',
      fetch: async () => Response.json({ message: 'Unauthorized' }, { status: 401 }),
    });

    const error = await client
      .request('/channels/2452', { method: 'GET' })
      .catch((reason) => reason);

    expect(JSON.stringify(error)).not.toContain('tmt_secret_token');
  });
});
