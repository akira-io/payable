import type {
  IdempotencyKeyResolver,
  IdempotencyKeyResolverContext,
} from '../../../domain/contracts/idempotency-key-resolver.contract';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { DefaultIdempotencyKeyResolver } from '../../services/idempotency/default-idempotency-key-resolver';

export interface ResolveIdempotencyKeyInput {
  context: IdempotencyKeyResolverContext;
  explicitKey?: string;
  entityResolver?: IdempotencyKeyResolver;
  globalResolver?: IdempotencyKeyResolver;
}

export class ResolveIdempotencyKeyAction {
  private readonly fallback = new DefaultIdempotencyKeyResolver();

  handle(input: ResolveIdempotencyKeyInput): IdempotencyKey {
    const resolved =
      input.explicitKey ??
      input.entityResolver?.resolve(input.context) ??
      input.globalResolver?.resolve(input.context) ??
      this.fallback.resolve(input.context);
    return IdempotencyKey.of(resolved);
  }
}
