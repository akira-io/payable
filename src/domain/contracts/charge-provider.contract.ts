import type { ChargeInput, ChargeResultDTO } from '../dtos/charge.dto';
import type { OperationContext } from '../dtos/common.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface ChargeCapable {
  readonly chargeIdempotency?: 'native' | 'unsupported';
  chargeIdempotencyFingerprint?(input: ChargeInput): unknown;
  isChargeFailureOutcomeUncertain?(error: unknown): boolean;
  charge(input: ChargeInput, context: OperationContext): Promise<ChargeResultDTO>;
}

export function isChargeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & ChargeCapable {
  return typeof (provider as Partial<ChargeCapable>).charge === 'function';
}
