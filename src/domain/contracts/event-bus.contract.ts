import type { DomainEvent } from '../events/domain-event';

export type EventListener<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

export interface EventBus {
  listen(name: string, listener: EventListener): void;
  emit(event: DomainEvent): Promise<void>;
}
