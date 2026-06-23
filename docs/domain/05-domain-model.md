# Domain Model

The domain model is the set of TypeScript interfaces in `src/domain/entities/`. Entities are plain, fully `readonly` data contracts: they hold no methods and no behavior. Behavior lives in value objects, state machines, and the application layer. Persisted shapes and provider identifiers are part of the entity; invariants and transitions are enforced elsewhere.

Every entity field is declared `readonly`, so an entity instance is never mutated in place; state changes produce new records.

## Shared building blocks

These mixins live in `src/domain/entities/common.ts` and are composed into the entities below.

| Type | Fields | Purpose |
| --- | --- | --- |
| `Timestamps` | `createdAt: Date`, `updatedAt: Date` | Creation and last-update instants. |
| `TenantScoped` | `tenantId: string \| null` | Multi-tenant scoping. `null` means the record is not bound to a tenant. |
| `StoredMoney` | `amount: number`, `currency: CurrencyCode` | Persisted money shape (minor units + currency code). See [Value Objects](06-value-objects.md) for the `Money` behavior. |
| `RecurringInterval` | `'day' \| 'week' \| 'month' \| 'year'` | Billing interval unit for recurring prices. |
| `Metadata` | `Record<string, string>` | Free-form string key/value bag. |

Monetary amounts on entities (`total`, `amountPaid`, `amountDue`, `amount`, `unitAmount`, `refundedAmount`) are plain `number` values expressed in **minor units** (cents for two-decimal currencies). They are never floats representing major units. The `currency: CurrencyCode` field on the same entity tells you how to interpret them. See [Value Objects](06-value-objects.md) for the no-floats rule and the `Money` helper that wraps these stored amounts.

## Entity reference diagram

```mermaid
erDiagram
  CUSTOMER ||--o{ SUBSCRIPTION : has
  CUSTOMER ||--o{ INVOICE : billed
  CUSTOMER ||--o{ PAYMENT : pays
  SUBSCRIPTION ||--o{ SUBSCRIPTION_ITEM : contains
  SUBSCRIPTION ||--o{ INVOICE : generates
  SUBSCRIPTION }o--|| PRICE : "priced by"
  SUBSCRIPTION_ITEM }o--|| PRICE : "priced by"
  PRODUCT ||--o{ PRICE : offers
  PAYMENT ||--o{ REFUND : "refunded by"

  CUSTOMER {
    string id PK
    string provider
    string providerCustomerId
    string billableType
    string billableId
    string email
    string name
    string tenantId
  }
  SUBSCRIPTION {
    string id PK
    string customerId FK
    string status
    string priceId FK
    number quantity
    date trialEndsAt
    date endsAt
  }
  SUBSCRIPTION_ITEM {
    string id PK
    string subscriptionId FK
    string priceId FK
    number quantity
  }
  INVOICE {
    string id PK
    string customerId FK
    string subscriptionId FK
    string status
    string currency
    number total
    number amountPaid
    number amountDue
  }
  PAYMENT {
    string id PK
    string customerId FK
    string status
    string currency
    number amount
    number refundedAmount
  }
  REFUND {
    string id PK
    string paymentId FK
    string status
    string currency
    number amount
  }
  PRODUCT {
    string id PK
    string name
    boolean active
  }
  PRICE {
    string id PK
    string productId FK
    string currency
    number unitAmount
    string interval
    boolean active
  }
}
```

Relationships are expressed by foreign-key string fields (`customerId`, `subscriptionId`, `priceId`, `productId`, `paymentId`). There are no embedded references; entities only carry the id of related records.

## Customer

`src/domain/entities/customer.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: links a host-application billable record (the thing being charged, identified by `billableType` + `billableId`) to a billing provider customer.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `provider` | `string` | Billing provider (e.g. `stripe`, `paddle`). |
| `providerCustomerId` | `string \| null` | Customer id on the provider; `null` before provisioning. |
| `billableType` | `string` | Host-side type discriminator. |
| `billableId` | `string` | Host-side record id. |
| `email` | `string` | Customer email. |
| `name` | `string \| null` | Optional display name. |
| `metadata` | `Metadata \| null` | Optional string key/value bag. |

Relationships: owns many `Subscription`, `Invoice`, and `Payment` records (each references `customerId`). On `Payment` the link is `customerId: string | null`, so a payment can exist without a customer.

Invariants (enforced outside the entity): the `(billableType, billableId)` pair identifies the host billable; `providerCustomerId` is populated once the customer is provisioned with the provider.

## Subscription

`src/domain/entities/subscription.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a recurring billing agreement for a customer against a price.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `customerId` | `string` | Owning customer. |
| `name` | `string` | Subscription name/type. |
| `provider` | `string` | Billing provider. |
| `providerSubscriptionId` | `string \| null` | Subscription id on the provider. |
| `status` | `SubscriptionStatus` | One of the values in [`subscription-status`](06-value-objects.md#subscription-status). |
| `priceId` | `string \| null` | Primary price reference. |
| `quantity` | `number` | Seat/unit count. |
| `trialEndsAt` | `Date \| null` | Trial end instant. |
| `endsAt` | `Date \| null` | Cancellation/grace-period end instant. |
| `currentPeriodStart` | `Date \| null` | Current billing period start. |
| `currentPeriodEnd` | `Date \| null` | Current billing period end. |

Relationships: belongs to one `Customer`; contains many `SubscriptionItem`; may generate `Invoice` records (`Invoice.subscriptionId`); references a `Price` via `priceId`.

Lifecycle: `status` is governed by the [Subscription state machine](07-state-machines.md#subscription). The date fields (`trialEndsAt`, `endsAt`) drive the lifecycle predicates below.

### Subscription state predicates

`src/domain/entities/subscription-state.ts`. Three pure functions read a `Subscription` plus an explicit `now: Date` and return a boolean. They compare epoch milliseconds via `getTime()`.

| Predicate | Returns `true` when | Exact logic |
| --- | --- | --- |
| `onTrial(subscription, now)` | The trial is still running. | `trialEndsAt !== null && trialEndsAt.getTime() > now.getTime()` |
| `onGracePeriod(subscription, now)` | The subscription has a future end date (canceled but not yet expired). | `endsAt !== null && endsAt.getTime() > now.getTime()` |
| `subscriptionEnded(subscription, now)` | The end date has passed (or is exactly now). | `endsAt !== null && endsAt.getTime() <= now.getTime()` |

Notes:
- `onTrial` uses a strict `>` comparison, so the exact `trialEndsAt` instant is no longer "on trial".
- `onGracePeriod` and `subscriptionEnded` are complementary across `endsAt`: with a non-null `endsAt`, exactly one is `true` for any given `now` (the boundary instant counts as ended, not grace).
- All three return `false` when the relevant date is `null`.

## Subscription Item

`src/domain/entities/subscription-item.entity.ts`. Extends `Timestamps` only (not tenant-scoped; it inherits tenancy through its parent subscription).

Purpose: a single priced line on a subscription, enabling multi-price subscriptions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `subscriptionId` | `string` | Owning subscription. |
| `priceId` | `string` | Price for this line. |
| `providerItemId` | `string \| null` | Item id on the provider. |
| `quantity` | `number` | Unit count for this line. |

Relationships: belongs to one `Subscription`; references one `Price`.

## Invoice

`src/domain/entities/invoice.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a billing document for a customer, optionally tied to a subscription.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `customerId` | `string` | Billed customer. |
| `subscriptionId` | `string \| null` | Source subscription, if any. |
| `provider` | `string` | Billing provider. |
| `providerInvoiceId` | `string \| null` | Invoice id on the provider. |
| `status` | `InvoiceStatus` | One of the values in [`invoice-status`](06-value-objects.md#invoice-status). |
| `currency` | `CurrencyCode` | Currency of the amounts below. |
| `total` | `number` | Invoice total, minor units. |
| `amountPaid` | `number` | Amount paid so far, minor units. |
| `amountDue` | `number` | Outstanding amount, minor units. |
| `number` | `string \| null` | Human-facing invoice number. |
| `hostedInvoiceUrl` | `string \| null` | Provider-hosted invoice URL. |
| `invoicePdf` | `string \| null` | PDF URL. |

Relationships: belongs to one `Customer`; optionally belongs to one `Subscription`.

Lifecycle: `status` is governed by the [Invoice state machine](07-state-machines.md#invoice). Amount fields are minor-unit integers interpreted by `currency`.

## Payment

`src/domain/entities/payment.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a charge against a provider, optionally attributed to a customer.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `customerId` | `string \| null` | Customer, if known. |
| `provider` | `string` | Billing provider. |
| `providerPaymentId` | `string \| null` | Payment id on the provider. |
| `status` | `PaymentStatus` | One of the values in [`payment-status`](06-value-objects.md#payment-status). |
| `currency` | `CurrencyCode` | Currency of the amounts below. |
| `amount` | `number` | Charge amount, minor units. |
| `refundedAmount` | `number` | Total refunded so far, minor units. |
| `reference` | `string \| null` | External reference. |
| `description` | `string \| null` | Free-text description. |

Relationships: optionally belongs to one `Customer`; refunded by many `Refund` records (each references `paymentId`).

Lifecycle: `status` is governed by the [Payment state machine](07-state-machines.md#payment). `refundedAmount` tracks cumulative refunds; the `partially_refunded` and `refunded` payment states correspond to partial vs. full refunds.

## Refund

`src/domain/entities/refund.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a refund issued against a payment.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `paymentId` | `string` | Payment being refunded. |
| `provider` | `string` | Billing provider. |
| `providerRefundId` | `string \| null` | Refund id on the provider. |
| `status` | `RefundStatus` | One of the values in [`refund-status`](06-value-objects.md#refund-status). |
| `currency` | `CurrencyCode` | Currency of `amount`. |
| `amount` | `number` | Refund amount, minor units. |
| `reason` | `string \| null` | Optional reason. |

Relationships: belongs to one `Payment` (required `paymentId`).

Lifecycle: `status` is governed by the [Refund state machine](07-state-machines.md#refund).

## Product

`src/domain/entities/product.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a sellable product that prices attach to.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `provider` | `string` | Billing provider. |
| `providerProductId` | `string \| null` | Product id on the provider. |
| `name` | `string` | Product name. |
| `description` | `string \| null` | Optional description. |
| `active` | `boolean` | Whether the product is sellable. |
| `metadata` | `Metadata \| null` | Optional string key/value bag. |

Relationships: offers many `Price` records (each references `productId`).

## Price

`src/domain/entities/price.entity.ts`. Extends `TenantScoped`, `Timestamps`.

Purpose: a specific price (one-off or recurring) for a product.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `provider` | `string` | Billing provider. |
| `providerPriceId` | `string \| null` | Price id on the provider. |
| `productId` | `string` | Owning product. |
| `currency` | `CurrencyCode` | Currency of `unitAmount`. |
| `unitAmount` | `number` | Unit price, minor units. |
| `interval` | `RecurringInterval \| null` | Billing interval; `null` for one-off prices. |
| `intervalCount` | `number \| null` | Number of intervals per billing cycle. |
| `active` | `boolean` | Whether the price is usable. |

Relationships: belongs to one `Product`; referenced by `Subscription.priceId` and `SubscriptionItem.priceId`.

Notes: a recurring price sets both `interval` and `intervalCount`; a one-off price leaves both `null`.

## Webhook Event

`src/domain/entities/webhook-event.entity.ts`. Extends `TenantScoped` (note: not `Timestamps` - it carries its own `receivedAt`/`processedAt` fields).

Purpose: a received provider webhook, persisted for idempotent processing and reconciliation.

`WebhookEventStatus = 'pending' | 'processed' | 'failed'`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `provider` | `string` | Source provider. |
| `providerEventId` | `string` | Event id on the provider (used for idempotency). |
| `type` | `string` | Raw provider event type. |
| `normalizedType` | `string \| null` | Canonical event type, once mapped. |
| `payload` | `string` | Raw payload string. |
| `data` | `Record<string, unknown>` | Parsed payload. |
| `headers` | `Record<string, string>` | Request headers. |
| `status` | `WebhookEventStatus` | Processing status. |
| `correlationId` | `string` | Correlation id for tracing. |
| `receivedAt` | `Date` | Receipt instant. |
| `processedAt` | `Date \| null` | Processing instant; `null` until processed. |

Invariants (enforced outside the entity): `(provider, providerEventId)` uniquely identifies an event, supporting idempotent webhook handling. See [Value Objects](06-value-objects.md#idempotencykey) for `IdempotencyKey.forWebhook`.

## Audit Log

`src/domain/entities/audit-log.entity.ts`. Extends `TenantScoped` (carries its own `createdAt`, not `Timestamps`).

Purpose: an immutable record of a mutation to a domain resource, for audit and traceability.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Local identifier. |
| `correlationId` | `string` | Correlation id linking related actions. |
| `actorType` | `string \| null` | Who acted (type). |
| `actorId` | `string \| null` | Who acted (id). |
| `action` | `string` | Action performed. |
| `resourceType` | `string` | Affected resource type. |
| `resourceId` | `string` | Affected resource id. |
| `before` | `Record<string, unknown> \| null` | State before the change. |
| `after` | `Record<string, unknown> \| null` | State after the change. |
| `metadata` | `Record<string, unknown> \| null` | Extra context. |
| `ipAddress` | `string \| null` | Origin IP. |
| `userAgent` | `string \| null` | Origin user agent. |
| `createdAt` | `Date` | When the entry was written. |

Notes: `before`/`after` capture the diff of the audited mutation; `correlationId` ties the entry to the request and to related webhook events.

---

[Previous: Configuration](../04-configuration.md) · [Index](../00-index.md) · [Next: Value Objects](06-value-objects.md)
