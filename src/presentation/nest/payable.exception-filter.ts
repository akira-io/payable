import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { PayableError } from '../../domain/errors/payable-error';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_IMPLEMENTED: 501,
  INVALID_WEBHOOK_SIGNATURE: 400,
  PROVIDER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PROVIDER_CAPABILITY_NOT_SUPPORTED: 422,
  CHECKOUT_PRICE_REQUIRED: 422,
  CHECKOUT_LINE_ITEMS_REQUIRED: 422,
  WEBHOOK_STORAGE_REQUIRED: 500,
};

interface HttpResponse {
  status(code: number): { json(body: unknown): unknown };
}

@Catch(PayableError)
export class PayableExceptionFilter implements ExceptionFilter {
  catch(error: PayableError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    response
      .status(STATUS_BY_CODE[error.code] ?? 500)
      .json({ error: error.code, message: error.message });
  }
}
