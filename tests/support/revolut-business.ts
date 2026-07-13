export interface RecordedBusinessRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface FakeBusinessResponse {
  status?: number;
  body?: unknown;
}

export function fakeRevolutBusinessFetch(...responses: FakeBusinessResponse[]) {
  const calls: RecordedBusinessRequest[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = responses.shift() ?? {};
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

export const businessAccount = {
  id: 'account-1',
  name: 'Operating GBP',
  balance: 3171.89,
  currency: 'GBP',
  state: 'active',
  public: false,
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-02T10:00:00Z',
};

export const businessTransaction = {
  id: 'transaction-1',
  type: 'transfer',
  state: 'completed',
  request_id: 'request-1',
  reference: 'Vendor invoice',
  created_at: '2026-06-03T10:00:00Z',
  updated_at: '2026-06-03T10:01:00Z',
  completed_at: '2026-06-03T10:01:00Z',
  legs: [
    {
      leg_id: 'leg-1',
      account_id: 'account-1',
      amount: -10.25,
      fee: 0.15,
      currency: 'GBP',
      description: 'To Vendor Ltd',
      balance: 3161.49,
      counterparty: {
        id: 'counterparty-1',
        account_id: 'counterparty-account-1',
        account_type: 'external',
      },
    },
  ],
};

export const businessCounterparty = {
  id: 'counterparty-1',
  name: 'Vendor Ltd',
  profile_type: 'business',
  state: 'created',
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-02T10:00:00Z',
  accounts: [
    {
      id: 'counterparty-account-1',
      name: 'Vendor GBP',
      bank_country: 'GB',
      currency: 'GBP',
      type: 'external',
    },
  ],
};

export const transferResponse = {
  id: 'transfer-1',
  state: 'completed',
  created_at: '2026-06-04T10:00:00Z',
  completed_at: '2026-06-04T10:00:01Z',
};

export const exchangeQuote = {
  from: { amount: 10.25, currency: 'GBP' },
  to: { amount: 12.91, currency: 'EUR' },
  rate: 1.2595,
  fee: { amount: 0.05, currency: 'GBP' },
  rate_date: '2026-06-04T09:59:00Z',
};

export const exchangeResponse = {
  id: 'exchange-1',
  type: 'exchange',
  state: 'completed',
  created_at: '2026-06-04T10:00:00Z',
  completed_at: '2026-06-04T10:00:01Z',
};
