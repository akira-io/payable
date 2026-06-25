import type {
  EventBus,
  EventListener,
  Unsubscribe,
} from '../../domain/contracts/event-bus.contract';
import type { Logger } from '../../domain/contracts/logger.contract';
import type { DomainEvent } from '../../domain/events/domain-event';

const WILDCARD = '*';

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(private readonly logger?: Logger) {}

  listen(name: string, listener: EventListener): Unsubscribe {
    const existing = this.listeners.get(name);
    if (existing) {
      existing.push(listener);
    } else {
      this.listeners.set(name, [listener]);
    }
    return () => this.remove(name, listener);
  }

  async emit(event: DomainEvent): Promise<void> {
    const targeted = this.listeners.get(event.name) ?? [];
    const wildcard = this.listeners.get(WILDCARD) ?? [];
    await Promise.all([...targeted, ...wildcard].map((listener) => this.dispatch(listener, event)));
  }

  private remove(name: string, listener: EventListener): void {
    const existing = this.listeners.get(name);
    if (!existing) {
      return;
    }
    const next = existing.filter((registered) => registered !== listener);
    if (next.length === 0) {
      this.listeners.delete(name);
      return;
    }
    this.listeners.set(name, next);
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
