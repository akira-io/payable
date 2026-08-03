import type { CatalogIdempotencyAction } from '../../domain/entities/catalog-mutation.entity';
import { assertAuthorized } from './assert-authorized';
import { type AuthorizationContext, isAuthorized } from './authorization-context';

export type CatalogMutationAction = CatalogIdempotencyAction;

const ACTION_LABELS: Record<CatalogMutationAction, string> = {
  'product.create': 'create product',
  'product.update': 'update product',
  'product.activate': 'activate product',
  'product.archive': 'archive product',
  'price.create': 'create price',
  'price.activate': 'activate price',
  'price.archive': 'archive price',
  'price.lookup-key.transfer': 'transfer price lookup key',
};

export function assertCatalogMutationAuthorized(
  enabled: boolean,
  authorization: AuthorizationContext | undefined,
  action: CatalogMutationAction,
): void {
  assertAuthorized(
    enabled || authorization !== undefined,
    isAuthorized,
    authorization,
    ACTION_LABELS[action],
    action,
  );
}
