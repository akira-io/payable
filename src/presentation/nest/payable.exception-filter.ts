import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { PayableError } from '../../domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

interface HttpResponse {
  status(code: number): { json(body: unknown): unknown };
}

function httpExceptionStatus(error: unknown): number | undefined {
  if (error instanceof PayableError) {
    return undefined;
  }
  const candidate = error as { getStatus?: () => number };
  if (typeof candidate.getStatus !== 'function') {
    return undefined;
  }
  const status = candidate.getStatus();
  return typeof status === 'number' ? status : undefined;
}

function httpExceptionBody(error: unknown): unknown {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (typeof response === 'string') {
    return { error: 'HTTP_ERROR', message: response };
  }
  return response ?? { error: 'HTTP_ERROR', message: 'Request failed' };
}

@Catch()
export class PayableExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const frameworkStatus = httpExceptionStatus(error);
    if (frameworkStatus !== undefined) {
      response.status(frameworkStatus).json(httpExceptionBody(error));
      return;
    }
    response.status(payableErrorStatus(error)).json(payableErrorBody(error));
  }
}
