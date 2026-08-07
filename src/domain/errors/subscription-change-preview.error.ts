import { PayableError } from './payable-error';

export type SubscriptionChangePreviewErrorCode =
  | 'SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND'
  | 'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED'
  | 'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE'
  | 'SUBSCRIPTION_CHANGE_PREVIEW_STALE'
  | 'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED'
  | 'SUBSCRIPTION_CHANGE_EMPTY'
  | 'SUBSCRIPTION_CHANGE_POLICY_REQUIRED';

export class SubscriptionChangePreviewError extends PayableError {
  constructor(message: string, code: SubscriptionChangePreviewErrorCode) {
    super(message, { code });
  }
}
