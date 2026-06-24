const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'stripe-signature',
  'paddle-signature',
]);

const SENSITIVE_PATTERNS = [
  'auth',
  'signature',
  'secret',
  'token',
  'api-key',
  'apikey',
  'cookie',
  'password',
];

function isSensitive(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_HEADERS.has(lower) || SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
  );
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitive(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
