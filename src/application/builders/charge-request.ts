import type { Money } from '../../domain/value-objects/money';

export interface ChargeRequest {
  amount: Money;
  reference?: string;
  description?: string;
}
