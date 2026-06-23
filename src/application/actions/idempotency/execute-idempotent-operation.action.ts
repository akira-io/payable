import type {
  IdempotencyKeyResolver,
  IdempotencyKeyResolverContext,
} from '../../../domain/contracts/idempotency-key-resolver.contract';
import type { IdempotencyService } from '../../services/idempotency/idempotency-service';
import { ResolveIdempotencyKeyAction } from './resolve-idempotency-key.action';

export interface ExecuteIdempotentOperationInput<T> {
  scope: string;
  context: IdempotencyKeyResolverContext;
  request: unknown;
  run: () => Promise<T>;
  explicitKey?: string;
  entityResolver?: IdempotencyKeyResolver;
  globalResolver?: IdempotencyKeyResolver;
  tenantId?: string | null;
  retryFailed?: boolean;
}

export class ExecuteIdempotentOperationAction {
  constructor(
    private readonly service: IdempotencyService,
    private readonly resolver: ResolveIdempotencyKeyAction = new ResolveIdempotencyKeyAction(),
  ) {}

  async handle<T>(input: ExecuteIdempotentOperationInput<T>): Promise<T> {
    const key = this.resolver.handle({
      explicitKey: input.explicitKey,
      context: input.context,
      entityResolver: input.entityResolver,
      globalResolver: input.globalResolver,
    });
    return this.service.execute({
      key: key.toString(),
      scope: input.scope,
      operation: input.context.operation,
      request: input.request,
      resourceType: input.context.resourceType ?? null,
      resourceId: input.context.resourceId ?? null,
      tenantId: input.tenantId,
      retryFailed: input.retryFailed,
      run: input.run,
    });
  }
}
