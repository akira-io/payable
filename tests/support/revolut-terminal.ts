export interface RecordedTerminalRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface FakeTerminalResponse {
  status?: number;
  body?: unknown;
}

export function fakeRevolutTerminalFetch(...responses: FakeTerminalResponse[]) {
  const calls: RecordedTerminalRequest[] = [];
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

export const terminal = {
  id: 'terminal-1',
  name: 'Counter one',
  type: 'newland_n950',
  serial_number: 'RT-00123456',
  battery_level: 84,
  online: true,
  last_online_at: '2026-07-14T09:00:00Z',
};

export const terminalIntent = {
  id: 'intent-1',
  state: 'pending',
  terminal_id: 'terminal-1',
  order_id: 'order-1',
  amount: 2500,
  currency: 'EUR',
  created_at: '2026-07-14T09:01:00Z',
  updated_at: '2026-07-14T09:01:00Z',
};
