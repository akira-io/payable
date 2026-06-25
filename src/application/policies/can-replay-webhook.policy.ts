import { type AuthorizationContext, isAuthorized } from './authorization-context';

export type ReplayWebhookContext = AuthorizationContext;

export class CanReplayWebhookPolicy {
  authorize(context: ReplayWebhookContext = {}): boolean {
    return isAuthorized(context);
  }
}
