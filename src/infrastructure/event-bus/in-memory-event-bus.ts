import type { EventBus, EventListener } from '../../domain/contracts/event-bus.contract';
import type { DomainEvent } from '../../domain/events/domain-event';

const WILDCARD = '*';

export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, EventListener[]>();

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
      await listener(event);
    }
  }
}
