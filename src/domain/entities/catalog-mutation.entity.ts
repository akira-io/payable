export type CatalogPersistenceAction =
  | 'product.create'
  | 'product.update'
  | 'product.activate'
  | 'product.archive'
  | 'price.create'
  | 'price.activate'
  | 'price.archive';

export type CatalogIdempotencyAction = CatalogPersistenceAction | 'price.lookup-key.transfer';
