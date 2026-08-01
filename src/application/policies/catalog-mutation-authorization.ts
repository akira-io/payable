import { assertAuthorized } from './assert-authorized';
import { type AuthorizationContext, isAuthorized } from './authorization-context';

export type CatalogMutationAction =
  | 'product.create'
  | 'product.update'
  | 'product.activate'
  | 'product.archive'
  | 'price.create'
  | 'price.activate'
  | 'price.archive';

const ACTION_LABELS: Record<CatalogMutationAction, string> = {
  'product.create': 'create product',
  'product.update': 'update product',
  'product.activate': 'activate product',
  'product.archive': 'archive product',
  'price.create': 'create price',
  'price.activate': 'activate price',
  'price.archive': 'archive price',
};

export function assertCatalogMutationAuthorized(
  enabled: boolean,
  authorization: AuthorizationContext | undefined,
  action: CatalogMutationAction,
): void {
  assertAuthorized(enabled, isAuthorized, authorization, ACTION_LABELS[action], action);
}
