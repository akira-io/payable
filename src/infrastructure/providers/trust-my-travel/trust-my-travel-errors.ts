import { PayableError } from '../../../domain/errors/payable-error';

const ERROR_CODE_BY_STATUS: Readonly<Record<number, string | undefined>> = {
  400: 'PROVIDER_REQUEST_INVALID',
  401: 'PROVIDER_AUTHENTICATION_FAILED',
  403: 'PROVIDER_AUTHENTICATION_FAILED',
  404: 'PROVIDER_RESOURCE_NOT_FOUND',
  429: 'PROVIDER_RATE_LIMITED',
  500: 'PROVIDER_UNAVAILABLE',
  504: 'PROVIDER_UNAVAILABLE',
};

export function toTmtPayableError(
  status: number,
  _body: unknown,
  provider = 'trust-my-travel',
): PayableError {
  return new PayableError(`Trust My Travel request failed with status ${status}`, {
    code: ERROR_CODE_BY_STATUS[status] ?? 'PROVIDER_ERROR',
    context: { provider, status },
  });
}

export async function withTmtErrors<T>(
  operation: () => Promise<T>,
  provider = 'trust-my-travel',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PayableError) {
      throw error;
    }

    throw new PayableError('Trust My Travel request failed', {
      code: 'PROVIDER_UNAVAILABLE',
      context: { provider },
      cause: error,
    });
  }
}
