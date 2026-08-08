export interface CollectionPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
