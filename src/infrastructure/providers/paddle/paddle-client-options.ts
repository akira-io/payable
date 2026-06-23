export interface PaddleClientOptions {
  customHeaders?: Record<string, string>;
}

export function buildPaddleClientOptions(idempotencyKey?: string): PaddleClientOptions {
  if (!idempotencyKey) {
    return {};
  }
  return { customHeaders: { 'Idempotency-Key': idempotencyKey } };
}
