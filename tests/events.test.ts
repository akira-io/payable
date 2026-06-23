import { describe, expect, it } from 'vitest';
import { CustomerCreatedEvent } from '../src/domain/events/customer-created.event';
import { InvoicePaidEvent } from '../src/domain/events/invoice-paid.event';
import { Money } from '../src/domain/value-objects/money';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';

const meta = { correlationId: 'corr_1', occurredAt: new Date('2026-01-01T00:00:00.000Z') };

describe('domain events', () => {
  it('use normalized names and carry payload and meta', () => {
    const event = new CustomerCreatedEvent(
      { customerId: 'cus_1', billableType: 'User', billableId: '1' },
      meta,
    );
    expect(event.name).toBe('customer.created');
    expect(event.payload.customerId).toBe('cus_1');
    expect(event.correlationId).toBe('corr_1');
    expect(event.occurredAt).toEqual(meta.occurredAt);
  });

  it('carry Money value objects without leaking primitives', () => {
    const event = new InvoicePaidEvent(
      { invoiceId: 'in_1', customerId: 'cus_1', total: Money.of(2550, 'EUR') },
      meta,
    );
    expect(event.name).toBe('invoice.paid');
    expect(event.payload.total.amount()).toBe(2550);
  });
});

describe('InMemoryEventBus', () => {
  it('dispatches to name-matched and wildcard listeners', async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.listen('customer.created', (event) => {
      received.push(`named:${event.name}`);
    });
    bus.listen('*', (event) => {
      received.push(`all:${event.name}`);
    });

    await bus.emit(
      new CustomerCreatedEvent(
        { customerId: 'cus_1', billableType: 'User', billableId: '1' },
        meta,
      ),
    );

    expect(received).toEqual(['named:customer.created', 'all:customer.created']);
  });

  it('awaits async listeners', async () => {
    const bus = new InMemoryEventBus();
    let done = false;
    bus.listen('customer.created', async () => {
      await Promise.resolve();
      done = true;
    });
    await bus.emit(
      new CustomerCreatedEvent(
        { customerId: 'cus_1', billableType: 'User', billableId: '1' },
        meta,
      ),
    );
    expect(done).toBe(true);
  });

  it('isolates a failing listener from siblings and the emit', async () => {
    const errors: string[] = [];
    const bus = new InMemoryEventBus({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (message) => errors.push(message),
    });
    let secondRan = false;
    bus.listen('customer.created', () => {
      throw new Error('listener boom');
    });
    bus.listen('customer.created', () => {
      secondRan = true;
    });

    await expect(
      bus.emit(
        new CustomerCreatedEvent(
          { customerId: 'cus_1', billableType: 'User', billableId: '1' },
          meta,
        ),
      ),
    ).resolves.toBeUndefined();
    expect(secondRan).toBe(true);
    expect(errors).toContain('Event listener failed');
  });
});
