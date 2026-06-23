import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

interface HttpResponse {
  status(code: number): { json(body: unknown): unknown };
}

@Catch()
export class PayableExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    response.status(payableErrorStatus(error)).json(payableErrorBody(error));
  }
}
