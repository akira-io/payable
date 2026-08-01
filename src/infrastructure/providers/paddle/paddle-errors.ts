import { PayableError, type PayableErrorOptions } from '../../../domain/errors/payable-error';

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

type PaddleNotFoundFactory = (options: PayableErrorOptions) => PayableError;

function isPaddleError(error: unknown): error is PaddleLikeError {
  return typeof error === 'object' && error !== null && ('code' in error || 'detail' in error);
}

export async function withPaddleErrors<T>(
  fn: () => Promise<T>,
  notFound?: PaddleNotFoundFactory,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PayableError || !isPaddleError(error)) {
      throw error;
    }
    const code = error.code ?? '';
    const options: PayableErrorOptions = {
      context: { provider: 'paddle', paddleCode: code, paddleType: error.type },
      cause: error,
    };
    if (code === 'not_found' && notFound) {
      throw notFound(options);
    }
    throw new PayableError(error.detail ?? error.message ?? 'Paddle request failed', {
      ...options,
      code:
        code === 'not_found'
          ? 'PROVIDER_REQUEST_INVALID'
          : (CODE_BY_PADDLE[code] ?? 'PROVIDER_ERROR'),
    });
  }
}
