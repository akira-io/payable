export interface AuthorizationContext {
  actorType?: string;
  actorId?: string;
  allowed?: boolean;
  tenantId?: string | null;
}

export function isAuthorized(context: AuthorizationContext = {}): boolean {
  return (
    context.allowed === true && typeof context.actorId === 'string' && context.actorId.length > 0
  );
}
