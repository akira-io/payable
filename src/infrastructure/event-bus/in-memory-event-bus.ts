import type { EventBus, EventListener } from '../../domain/contracts/event-bus.contract';
import type { Logger } from '../../domain/contracts/logger.contract';
import type { DomainEvent } from '../../domain/events/domain-event';

const WILDCARD = '*';

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(private readonly logger?: Logger) {}

  listen(name: string, listener: EventListener): void {
    const existing = this.listeners.get(name);
    if (existing) {
      existing.push(listener);
      return;
    }
    this.listeners.set(name, [listener]);
  }

  async emit(event: DomainEvent): Promise<void> {
    const targeted = this.listeners.get(event.name) ?? [];
    const wildcard = this.listeners.get(WILDCARD) ?? [];
    for (const listener of [...targeted, ...wildcard]) {
      await this.dispatch(listener, event);
    }
  }

  private async dispatch(listener: EventListener, event: DomainEvent): Promise<void> {
    try {
      await listener(event);
    } catch (error) {
      this.logger?.error('Event listener failed', {
        event: event.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
