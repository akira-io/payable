import type {
  IdempotencyKeyResolver,
  IdempotencyKeyResolverContext,
} from '../../../domain/contracts/idempotency-key-resolver.contract';

export class DefaultIdempotencyKeyResolver implements IdempotencyKeyResolver {
  resolve(context: IdempotencyKeyResolverContext): string {
    return [
      'op',
      context.operation,
      context.provider ?? 'na',
      context.resourceType ?? 'na',
      context.resourceId ?? 'na',
    ].join(':');
  }
}
