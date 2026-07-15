import { type ArgumentsHost, Catch, type ExceptionFilter, Optional } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { PayableError } from '../../domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

interface ExpressLikeResponse {
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
  constructor(@Optional() private readonly adapterHost?: HttpAdapterHost) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const frameworkStatus = httpExceptionStatus(error);
    const status = frameworkStatus ?? payableErrorStatus(error);
    const body = frameworkStatus === undefined ? payableErrorBody(error) : httpExceptionBody(error);
    const httpAdapter = this.adapterHost?.httpAdapter;
    if (httpAdapter) {
      httpAdapter.reply(response, body, status);
      return;
    }
    (response as ExpressLikeResponse).status(status).json(body);
  }
}
