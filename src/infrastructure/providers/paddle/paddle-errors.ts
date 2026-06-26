import { PayableError } from '../../../domain/errors/payable-error';

const CODE_BY_PADDLE: Record<string, string> = {
  payment_declined: 'PROVIDER_CARD_DECLINED',
  payment_method_declined: 'PROVIDER_CARD_DECLINED',
  transaction_payment_declined: 'PROVIDER_CARD_DECLINED',
  rate_limit_exceeded: 'PROVIDER_RATE_LIMITED',
  too_many_requests: 'PROVIDER_RATE_LIMITED',
  authentication_failed: 'PROVIDER_AUTH_FAILED',
  unauthorized: 'PROVIDER_AUTH_FAILED',
  forbidden: 'PROVIDER_AUTH_FAILED',
  request_validation_failed: 'PROVIDER_REQUEST_INVALID',
  invalid_field: 'PROVIDER_REQUEST_INVALID',
  bad_request: 'PROVIDER_REQUEST_INVALID',
};

interface PaddleLikeError {
  code?: string;
  type?: string;
  detail?: string;
  message?: string;
}

function isPaddleError(error: unknown): error is PaddleLikeError {
  return typeof error === 'object' && error !== null && ('code' in error || 'detail' in error);
}

export async function withPaddleErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PayableError || !isPaddleError(error)) {
      throw error;
    }
    const code = error.code ?? '';
    throw new PayableError(error.detail ?? error.message ?? 'Paddle request failed', {
      code: CODE_BY_PADDLE[code] ?? 'PROVIDER_ERROR',
      context: { provider: 'paddle', paddleCode: code, paddleType: error.type },
      cause: error,
    });
  }
}
