import type { Money } from '../../domain/value-objects/money';
import type { AuthorizationContext } from '../policies/authorization-context';

export interface AuthorizePaymentRequest {
  amount: Money;
  reference: string;
  description?: string;
  paymentMethodId?: string;
  successUrl?: string;
  cancelUrl?: string;
  providerData?: Record<string, unknown>;
  authorization?: AuthorizationContext;
}
