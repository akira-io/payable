const SENSITIVE_NAMES = new Set([
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
  'api_key',
  'cookie',
  'password',
];

export function isSensitiveKey(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_NAMES.has(lower) || SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
  );
}
