import type { OperationContext } from '../dtos/common.dto';
import type {
  AuthorizationResultDTO,
  AuthorizePaymentInput,
  CapturePaymentInput,
  CaptureResultDTO,
  VoidPaymentInput,
  VoidResultDTO,
} from '../dtos/payment-lifecycle.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface AuthorizeCapable {
  readonly authorizeIdempotency?: 'native' | 'unsupported';
  authorize(input: AuthorizePaymentInput, ctx: OperationContext): Promise<AuthorizationResultDTO>;
}

export interface CaptureCapable {
  readonly captureIdempotency?: 'native' | 'unsupported';
  capture(input: CapturePaymentInput, ctx: OperationContext): Promise<CaptureResultDTO>;
}

export interface VoidCapable {
  readonly voidIdempotency?: 'native' | 'unsupported';
  void(input: VoidPaymentInput, ctx: OperationContext): Promise<VoidResultDTO>;
}

export function isAuthorizeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & AuthorizeCapable {
  return typeof (provider as Partial<AuthorizeCapable>).authorize === 'function';
}

export function isCaptureCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CaptureCapable {
  return typeof (provider as Partial<CaptureCapable>).capture === 'function';
}

export function isVoidCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & VoidCapable {
  return typeof (provider as Partial<VoidCapable>).void === 'function';
}
