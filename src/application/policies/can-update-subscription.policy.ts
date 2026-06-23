import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanUpdateSubscriptionPolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
