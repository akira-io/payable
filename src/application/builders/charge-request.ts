import type { Money } from '../../domain/value-objects/money';
import type { AuthorizationContext } from '../policies/authorization-context';

export interface ChargeRequest {
  amount: Money;
  reference?: string;
  description?: string;
  authorization?: AuthorizationContext;
}
