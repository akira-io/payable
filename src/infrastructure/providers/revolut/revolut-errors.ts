import { PayableError } from '../../../domain/errors/payable-error';

interface RevolutErrorBody {
  code?: string | number;
  message?: string;
}

const CODE_BY_REVOLUT: Record<string, string> = {
  unauthenticated: 'PROVIDER_AUTH_FAILED',
  unauthorized: 'PROVIDER_AUTH_FAILED',
  forbidden: 'PROVIDER_AUTH_FAILED',
  bad_request: 'PROVIDER_REQUEST_INVALID',
  validation_error: 'PROVIDER_REQUEST_INVALID',
  too_many_requests: 'PROVIDER_RATE_LIMITED',
  rate_limit_exceeded: 'PROVIDER_RATE_LIMITED',
  idempotency_conflict: 'PROVIDER_IDEMPOTENCY_CONFLICT',
  '3020': 'PROVIDER_IDEMPOTENCY_CONFLICT',
};

const CODE_BY_STATUS: Record<number, string> = {
  400: 'PROVIDER_REQUEST_INVALID',
  401: 'PROVIDER_AUTH_FAILED',
  403: 'PROVIDER_AUTH_FAILED',
  409: 'PROVIDER_IDEMPOTENCY_CONFLICT',
  422: 'PROVIDER_REQUEST_INVALID',
  429: 'PROVIDER_RATE_LIMITED',
};

export function toRevolutPayableError(
  status: number,
  body: unknown,
  provider = 'revolut',
): PayableError {
  const parsed = parseRevolutError(body);
  const code = parsed.code === undefined ? '' : String(parsed.code);
  return new PayableError(parsed.message ?? `Revolut request failed with status ${status}`, {
    code: CODE_BY_REVOLUT[code] ?? CODE_BY_STATUS[status] ?? 'PROVIDER_ERROR',
    context: { provider, revolutCode: code || undefined, status },
  });
}

export function revolutNetworkError(error: unknown, provider = 'revolut'): PayableError {
  if (error instanceof PayableError) {
    return error;
  }
  return new PayableError('Revolut request failed', {
    code: 'PROVIDER_ERROR',
    context: { provider },
    cause: error,
  });
}

function parseRevolutError(body: unknown): RevolutErrorBody {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    code:
      typeof record.code === 'string' || typeof record.code === 'number' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}
