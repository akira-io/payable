import { PayableError } from '../../../domain/errors/payable-error';
import { Email } from '../../../domain/value-objects/email';

export function normalizeCustomerEmail(value: string | undefined): string {
  try {
    return Email.of(value ?? '').toString();
  } catch {
    throw new PayableError(`Invalid customer email: ${value}`, {
      code: 'CUSTOMER_EMAIL_INVALID',
      context: { billableEmail: value },
    });
  }
}
