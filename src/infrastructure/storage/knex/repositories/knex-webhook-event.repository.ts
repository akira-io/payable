import type { WebhookEventRepository } from '../../../../domain/contracts/webhook-event-repository.contract';
import type { WebhookEvent } from '../../../../domain/entities/webhook-event.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexWebhookEventRepository implements WebhookEventRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<WebhookEvent> {
    return this.unsupported('create');
  }

  findById(): Promise<WebhookEvent | null> {
    return this.unsupported('findById');
  }

  findByProviderEvent(): Promise<WebhookEvent | null> {
    return this.unsupported('findByProviderEvent');
  }

  markStatus(): Promise<WebhookEvent> {
    return this.unsupported('markStatus');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexWebhookEventRepository.${op} (Phase 3)`);
  }
}
