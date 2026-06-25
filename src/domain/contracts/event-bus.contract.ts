import type { DomainEvent } from '../events/domain-event';

export type EventListener<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

export type Unsubscribe = () => void;

export interface EventBus {
  listen(name: string, listener: EventListener): Unsubscribe;
  emit(event: DomainEvent): Promise<void>;
}
