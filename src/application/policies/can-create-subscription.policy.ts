import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanCreateSubscriptionPolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
