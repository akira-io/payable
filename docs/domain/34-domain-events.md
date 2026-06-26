# Domain Events

Domain events live in `src/domain/events/`. Each event is an immutable record of something that happened in the domain. Each extends [`DomainEvent`](#domainevent-base) and carries a canonical [`NormalizedEventName`](#domainevent-base), a typed payload, and trace metadata.

The event classes are exported public API (typed contracts consumers can build, dispatch, and subscribe to via the [`EventBus`](33-contracts.md#eventbus); default `InMemoryEventBus`). Two emission paths exist, and they are distinct - read this before assuming an event fires:

- **In-process `EventBus` (best-effort).** The engine itself currently instantiates and emits exactly one of these classes: `WebhookProcessedEvent`, emitted by the `process-webhook` pipeline **after** its transaction commits, fire-and-forget (`.emit(...).catch(() => {})`). It is not transactional and is not retried. The other 13 classes are provided as typed contracts but are **not** emitted internally yet - emit them from your own listeners/actions if you need them.
- **Transactional outbox (exactly-once).** Durable, replayable publication does **not** go through these classes. The `process-webhook` pipeline writes an `OutboxEvent` row in the same transaction as the webhook state change, keyed by an `eventType` string of the form `${normalizedType}.v1` (e.g. `payment.succeeded.v1`) with `{ providerEventId, data }` as payload and a `dedupeKey`. The outbox relay then delivers it. See [Reliability](../features/15-reliability.md). So the durable event stream is keyed by normalized-type strings, not by the `DomainEvent` subclasses below.

## DomainEvent base

`src/domain/events/domain-event.ts`. The abstract base every event extends.

```ts
export abstract class DomainEvent<P = unknown> {
  readonly eventId: string;
  readonly payload: Readonly<P>;

  constructor(
    readonly name: NormalizedEventName,
    payload: P,
    readonly correlationId: string,
    readonly occurredAt: Date,
    readonly version: number = 1,
  ) {
    this.eventId = globalThis.crypto.randomUUID();
    this.payload = Object.freeze(payload) as Readonly<P>;
  }
}
```

- `eventId` - a fresh UUID per instance.
- `name` - a `NormalizedEventName` (the canonical cross-provider event type, e.g. `payment.succeeded`).
- `payload` - the typed payload, **frozen** on construction.
- `correlationId`, `occurredAt`, `version` - trace id, instant, and schema version (defaults to `1`).

Each concrete event takes `(payload, meta: DomainEventMeta)`, where `DomainEventMeta = { correlationId, occurredAt }`, and passes its fixed `NormalizedEventName` to `super`.

```ts
export interface DomainEventMeta {
  correlationId: string;
  occurredAt: Date;
}
```

## Event catalog

The 14 concrete event classes and their payload types. The "Name" column is the `NormalizedEventName` the event carries; note the `Invoice*` and `Subscription*` class names do not always match their wire names one-to-one. The "Semantics" column is the domain fact the event type represents - **not** a guarantee the engine emits it (only `WebhookProcessedEvent` is emitted internally; see above).

| Event class | Name | Payload type | Semantics |
| --- | --- | --- | --- |
| `CustomerCreatedEvent` | `customer.created` | `CustomerCreatedPayload` | A customer was provisioned. |
| `CheckoutCreatedEvent` | `checkout.created` | `CheckoutCreatedPayload` | A checkout session was opened. |
| `SubscriptionCreatedEvent` | `subscription.created` | `SubscriptionCreatedPayload` | A subscription was created. |
| `SubscriptionUpdatedEvent` | `subscription.updated` | `SubscriptionUpdatedPayload` | A subscription was swapped/updated. |
| `SubscriptionCancelledEvent` | `subscription.cancelled` | `SubscriptionCancelledPayload` | A subscription was cancelled. |
| `SubscriptionResumedEvent` | `subscription.resumed` | `SubscriptionResumedPayload` | A cancelled subscription was resumed. |
| `PaymentSucceededEvent` | `payment.succeeded` | `PaymentSucceededPayload` | A payment settled successfully. |
| `PaymentFailedEvent` | `payment.failed` | `PaymentFailedPayload` | A payment failed. |
| `RefundCreatedEvent` | `refund.created` | `RefundCreatedPayload` | A refund was issued against a payment. |
| `InvoiceCreatedEvent` | `invoice.created` | `InvoiceCreatedPayload` | An invoice was created. |
| `InvoicePaidEvent` | `invoice.paid` | `InvoicePaidPayload` | An invoice was paid. |
| `InvoiceFailedEvent` | `invoice.payment_failed` | `InvoiceFailedPayload` | An invoice payment failed. |
| `WebhookReceivedEvent` | `webhook.received` | `WebhookReceivedPayload` | A provider webhook was received and persisted. |
| `WebhookProcessedEvent` | `webhook.processed` | `WebhookProcessedPayload` | A webhook finished processing. **Emitted** by the `process-webhook` pipeline (best-effort, post-commit). |

The `NormalizedEventName` union (in `domain-event.ts`) is the closed set of canonical names. It is wider than the 14 classes above - it also includes provider-mapped names such as `customer.updated`, `checkout.completed`, `refund.succeeded`, and `refund.failed`, which appear as outbox `eventType` values (suffixed `.v1`) even though no dedicated event class exists for them.

## Representative payloads

```ts
export interface PaymentSucceededPayload {
  paymentId: string;
  customerId: string | null;
  amount: Money;
}

export interface SubscriptionCreatedPayload {
  subscriptionId: string;
  customerId: string;
  name: string;
  status: SubscriptionStatus;
}

export interface WebhookReceivedPayload {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  type: string;
}
```

Monetary fields on payloads carry [`Money`](06-value-objects.md#money) (for example `amount` / `total`), not raw integers. See each `*.event.ts` file for the full payload definitions.

---

[Previous: Contracts](33-contracts.md) · [Index](../00-index.md) · [Next: State Machines](07-state-machines.md)
