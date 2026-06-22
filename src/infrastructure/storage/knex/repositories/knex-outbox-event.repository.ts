import type {
  OutboxEvent,
  OutboxEventRepository,
} from '../../../../domain/contracts/outbox-event-repository.contract';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexOutboxEventRepository implements OutboxEventRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<OutboxEvent> {
    return this.unsupported('create');
  }

  pullPending(): Promise<OutboxEvent[]> {
    return this.unsupported('pullPending');
  }

  markPublished(): Promise<void> {
    return this.unsupported('markPublished');
  }

  markFailed(): Promise<void> {
    return this.unsupported('markFailed');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexOutboxEventRepository.${op} (Phase 3)`);
  }
}
