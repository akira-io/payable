import { PayableError, type PayableErrorOptions } from '../../../domain/errors/payable-error';

const CODE_BY_TYPE: Record<string, string> = {
  StripeCardError: 'PROVIDER_CARD_DECLINED',
  StripeRateLimitError: 'PROVIDER_RATE_LIMITED',
  StripeIdempotencyError: 'PROVIDER_IDEMPOTENCY_CONFLICT',
  StripeInvalidRequestError: 'PROVIDER_REQUEST_INVALID',
  StripeAuthenticationError: 'PROVIDER_AUTH_FAILED',
};

interface StripeLikeError {
  type?: string;
  code?: string;
  message?: string;
}

type StripeNotFoundFactory = (options: PayableErrorOptions) => PayableError;

function isStripeError(error: unknown): error is StripeLikeError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const type = (error as StripeLikeError).type;
  return typeof type === 'string' && type.startsWith('Stripe');
}

export async function withStripeErrors<T>(
  fn: () => Promise<T>,
  provider = 'stripe',
  notFound?: StripeNotFoundFactory,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PayableError || !isStripeError(error)) {
      throw error;
    }
    const options: PayableErrorOptions = {
      context: { provider, stripeType: error.type, stripeCode: error.code },
      cause: error,
    };
    if (error.code === 'resource_missing' && notFound) {
      throw notFound(options);
    }
    throw new PayableError(error.message ?? 'Stripe request failed', {
      ...options,
      code: CODE_BY_TYPE[error.type ?? ''] ?? 'PROVIDER_ERROR',
    });
  }
}
