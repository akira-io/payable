import { PayableError } from '../../../domain/errors/payable-error';

interface SispLikeError {
  name?: string;
  message?: string;
}

export async function withSispErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PayableError) {
      throw error;
    }
    const candidate = error as SispLikeError;
    throw new PayableError(candidate.message ?? 'SISP request failed', {
      code: 'PROVIDER_SISP_ERROR',
      context: { provider: 'sisp', sispError: candidate.name },
      cause: error,
    });
  }
}
