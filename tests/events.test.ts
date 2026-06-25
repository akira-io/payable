import { describe, expect, it } from 'vitest';
import { CheckoutCreatedEvent } from '../src/domain/events/checkout-created.event';
import { CustomerCreatedEvent } from '../src/domain/events/customer-created.event';
import { InvoicePaidEvent } from '../src/domain/events/invoice-paid.event';
import { PaymentSucceededEvent } from '../src/domain/events/payment-succeeded.event';
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

  it('names a created checkout as created, not completed', () => {
    const event = new CheckoutCreatedEvent(
      { checkoutId: 'cs_1', customerId: 'cus_1', url: 'https://pay.test/cs_1' },
      meta,
    );
    expect(event.name).toBe('checkout.created');
  });

  it('allows a null customer on a payment that has no linked customer', () => {
    const event = new PaymentSucceededEvent(
      { paymentId: 'pi_1', customerId: null, amount: Money.of(500, 'USD') },
      meta,
    );
    expect(event.payload.customerId).toBeNull();
    expect(event.payload.amount.amount()).toBe(500);
  });

  it('carry Money value objects without leaking primitives', () => {
    const event = new InvoicePaidEvent(
      { invoiceId: 'in_1', customerId: 'cus_1', total: Money.of(2550, 'EUR') },
      meta,
    );
    expect(event.name).toBe('invoice.paid');
    expect(event.payload.total.amount()).toBe(2550);
  });

  it('assign a unique event id and a default schema version', () => {
    const make = () =>
      new CustomerCreatedEvent(
        { customerId: 'cus_1', billableType: 'User', billableId: '1' },
        meta,
      );
    const first = make();
    const second = make();
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.eventId).not.toBe(second.eventId);
    expect(first.version).toBe(1);
  });

  it('freeze the payload so a listener cannot mutate it', () => {
    const event = new CustomerCreatedEvent(
      { customerId: 'cus_1', billableType: 'User', billableId: '1' },
      meta,
    );
    expect(() => {
      (event.payload as { customerId: string }).customerId = 'tampered';
    }).toThrow(TypeError);
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

  it('stops dispatching to a listener after its unsubscribe handle is called', async () => {
    const bus = new InMemoryEventBus();
    let calls = 0;
    const unsubscribe = bus.listen('customer.created', () => {
      calls += 1;
    });
    const event = () =>
      new CustomerCreatedEvent(
        { customerId: 'cus_1', billableType: 'User', billableId: '1' },
        meta,
      );

    await bus.emit(event());
    unsubscribe();
    await bus.emit(event());

    expect(calls).toBe(1);
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
