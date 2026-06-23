import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { PayableError } from '../../domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

interface HttpResponse {
  status(code: number): { json(body: unknown): unknown };
}

@Catch(PayableError)
export class PayableExceptionFilter implements ExceptionFilter {
  catch(error: PayableError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    response.status(payableErrorStatus(error)).json(payableErrorBody(error));
  }
}
