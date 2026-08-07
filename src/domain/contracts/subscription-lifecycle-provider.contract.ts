import type { OperationContext } from '../dtos/common.dto';
import type { SubscriptionDTO } from '../dtos/subscription.dto';
import type {
  PausePaymentCollectionPolicy,
  PauseSubscriptionPolicy,
  ResumePausedSubscriptionPolicy,
} from '../dtos/subscription-pause-policy.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface PauseSubscriptionInput extends PauseSubscriptionPolicy {
  providerSubscriptionId: string;
}

export type ResumePausedSubscriptionInput = ResumePausedSubscriptionPolicy & {
  providerSubscriptionId: string;
};

export interface PausePaymentCollectionInput extends PausePaymentCollectionPolicy {
  providerSubscriptionId: string;
}

export interface ResumePaymentCollectionInput {
  providerSubscriptionId: string;
}

export interface CancelScheduledSubscriptionChangeInput {
  providerSubscriptionId: string;
}

export interface SubscriptionPauseCapable {
  pauseSubscription(input: PauseSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO>;
}

export interface PausedSubscriptionResumeCapable {
  resumePausedSubscription(
    input: ResumePausedSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
}

export interface SubscriptionPaymentCollectionCapable {
  pausePaymentCollection(
    input: PausePaymentCollectionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
  resumePaymentCollection(
    input: ResumePaymentCollectionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
}

export interface ScheduledSubscriptionChangeCapable {
  cancelScheduledSubscriptionChange(
    input: CancelScheduledSubscriptionChangeInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO>;
}

export function isSubscriptionPauseCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionPauseCapable {
  return typeof (provider as Partial<SubscriptionPauseCapable>).pauseSubscription === 'function';
}

export function isPausedSubscriptionResumeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PausedSubscriptionResumeCapable {
  return (
    typeof (provider as Partial<PausedSubscriptionResumeCapable>).resumePausedSubscription ===
    'function'
  );
}

export function isSubscriptionPaymentCollectionCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionPaymentCollectionCapable {
  const candidate = provider as Partial<SubscriptionPaymentCollectionCapable>;
  return (
    typeof candidate.pausePaymentCollection === 'function' &&
    typeof candidate.resumePaymentCollection === 'function'
  );
}

export function isScheduledSubscriptionChangeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & ScheduledSubscriptionChangeCapable {
  return (
    typeof (provider as Partial<ScheduledSubscriptionChangeCapable>)
      .cancelScheduledSubscriptionChange === 'function'
  );
}
