export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddleClientOptions {
  environment: PaddleEnvironment;
}

export function buildPaddleClientOptions(environment?: PaddleEnvironment): PaddleClientOptions {
  return {
    environment: environment === 'sandbox' ? 'sandbox' : 'production',
  };
}
