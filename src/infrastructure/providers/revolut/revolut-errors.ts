import { PayableError } from '../../../domain/errors/payable-error';

interface RevolutErrorBody {
  code?: string;
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
};

export function toRevolutPayableError(status: number, body: unknown): PayableError {
  const parsed = parseRevolutError(body);
  const code = parsed.code ?? '';
  return new PayableError(parsed.message ?? `Revolut request failed with status ${status}`, {
    code: CODE_BY_REVOLUT[code] ?? 'PROVIDER_ERROR',
    context: { provider: 'revolut', revolutCode: code || undefined, status },
  });
}

export function revolutNetworkError(error: unknown): PayableError {
  if (error instanceof PayableError) {
    return error;
  }
  return new PayableError('Revolut request failed', {
    code: 'PROVIDER_ERROR',
    context: { provider: 'revolut' },
    cause: error,
  });
}

function parseRevolutError(body: unknown): RevolutErrorBody {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}
