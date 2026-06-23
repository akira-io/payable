import { PayableError } from '../../domain/errors/payable-error';
import type { AuthorizationContext } from './authorization-context';

export function assertAuthorized(
  enabled: boolean,
  authorize: (context: AuthorizationContext) => boolean,
  context: AuthorizationContext | undefined,
  action: string,
): void {
  if (!enabled) {
    return;
  }
  if (!authorize(context ?? {})) {
    throw new PayableError(`Not authorized to ${action}`, {
      code: 'AUTHORIZATION_DENIED',
      context: { action },
    });
  }
}
