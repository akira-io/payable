const SIGNATURE_HEADER_BY_PROVIDER: Record<string, string> = {
  stripe: 'stripe-signature',
  paddle: 'paddle-signature',
  revolut: 'revolut-signature',
};

const KNOWN_SIGNATURE_HEADERS = [...new Set(Object.values(SIGNATURE_HEADER_BY_PROVIDER))];

const DEFAULT_SIGNATURE_HEADER = 'stripe-signature';

export function resolveWebhookSignatureHeader(
  provider: string | undefined,
  headers: Record<string, unknown>,
  override?: string,
): string {
  if (override) {
    return override.toLowerCase();
  }
  const mapped = provider ? SIGNATURE_HEADER_BY_PROVIDER[provider] : undefined;
  if (mapped) {
    return mapped;
  }
  const present = KNOWN_SIGNATURE_HEADERS.find((name) => headers[name] !== undefined);
  return present ?? DEFAULT_SIGNATURE_HEADER;
}
