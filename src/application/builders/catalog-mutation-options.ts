import type { AuthorizationContext } from '../policies/authorization-context';

export interface CatalogMutationOptions {
  authorization?: AuthorizationContext;
  idempotencyKey?: string;
}
