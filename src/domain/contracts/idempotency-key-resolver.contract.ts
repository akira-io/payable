export interface IdempotencyKeyResolverContext {
  operation: string;
  provider?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface IdempotencyKeyResolver {
  resolve(context: IdempotencyKeyResolverContext): string | null;
}
