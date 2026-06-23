import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanCancelSubscriptionPolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
