import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanCreateCheckoutPolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
