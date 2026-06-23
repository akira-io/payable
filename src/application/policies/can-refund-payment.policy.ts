import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanRefundPaymentPolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
