export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddleClientOptions {
  environment: PaddleEnvironment;
  customHeaders?: Record<string, string>;
}

export function buildPaddleClientOptions(
  environment?: PaddleEnvironment,
  idempotencyKey?: string,
): PaddleClientOptions {
  return {
    environment: environment === 'sandbox' ? 'sandbox' : 'production',
    customHeaders: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  };
}
