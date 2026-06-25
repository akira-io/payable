import { type AuthorizationContext, isAuthorized } from './authorization-context';

export class CanChargePolicy {
  authorize(context: AuthorizationContext = {}): boolean {
    return isAuthorized(context);
  }
}
