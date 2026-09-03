# Payment Authorization, Capture, and Void

Payable models card authorization separately from collection. The public `PaymentStatus` union now
includes `authorized`; this is a breaking type-level change for consumers with exhaustive status
switches.

## API

Start an authorization from a customer context:

```ts
const authorization = await payable.customer(customer, 'stripe').authorize({
  amount: Money.of(10_000, 'USD'),
  reference: 'order-402',
  paymentMethodId: 'pm_123',
});

await payable.payment(authorization.payment.id).capture({
  reference: 'order-402:capture',
});
```

Void instead of capture with `payable.payment(id).void({ reference })`. Capture accepts an optional
amount and provider-neutral allocations shaped as `{ reference, amount }`. Provider adapters may
constrain those fields further; Trust My Travel uses the allocation reference as the booking id.

`AuthorizeCapable`, `CaptureCapable`, and `VoidCapable` are independent. Payable checks both the
advertised capability and the structural guard. Unsupported providers fail with
`PROVIDER_CAPABILITY_NOT_SUPPORTED` before a provider request.

## Lifecycle and events

An authorization can move from `pending` or `processing` to `authorized`. Only `authorized` can
move to `succeeded` through capture or `canceled` through void. Expired authorizations fail locally
with `PAYMENT_AUTHORIZATION_EXPIRED`; Payable does not send a late provider request.

Successful transitions produce `payment.authorized`, `payment.captured`, and `payment.voided`
events and matching audit actions. `Payment` exposes `authorizedAt`, `authorizationExpiresAt`, and
`capturedAmount`. It never exposes provider secrets or raw responses.

## Reliability requirements

Authorization, capture, and void require a persistent idempotency store. Capture and void also
require a configured `LockDriver` whose `distributed` property is `true`. The lock identity contains
the tenant, provider, and linked provider payment id, so capture and void cannot race across
processes and tenants cannot block or observe one another. A durable idempotency claim uses the
same identity across capture and void, preventing a new reference from bypassing an uncertain or
in-progress terminal mutation.

If a provider call does not return its expected terminal state, Payable leaves the payment
`authorized` and raises `PAYMENT_OUTCOME_UNKNOWN`. Stripe and Revolut declare native mutation
idempotency, so the same request can safely recover after a transient failure. Trust My Travel does
not provide an equivalent idempotency key: Payable records uncertain mutations as requiring
reconciliation and refuses to repeat them blindly. A provider callback can reconcile the stored
payment, while an unresolved TMT outcome requires operator reconciliation. Completed idempotency
records revive the current stored payment after a process restart.

## Provider capability matrix

| Provider | Authorize | Capture | Void | Notes |
| --- | --- | --- | --- | --- |
| Stripe | yes | yes | yes | Manual-capture PaymentIntents; authorize, capture, and cancel use Stripe idempotency keys. |
| Revolut | yes | yes | yes | Manual-capture Merchant orders; authorize, capture, and cancel use Merchant API idempotency keys. |
| Trust My Travel | yes | yes | yes | Authorization starts in the modal; capture/void use `linked_id`; allocations are capture-only; uncertain mutations require reconciliation. |
| Paddle | no | no | no | The adapter advertises no authorization lifecycle capability. |
| SISP | no | no | no | The redirect integration advertises no authorization lifecycle capability. |

Trust My Travel capture windows are issuer-dependent and typically no longer than five days. The
adapter records that conservative five-day boundary in `authorizationExpiresAt`; applications must
treat it as the latest safe capture time and should capture earlier. Set
`authorizationWindowMs` in `TrustMyTravelProviderOptions` when the configured channel or issuer uses
a shorter window.

## Storage migration

Run the Knex migrator to apply `023-payment-authorization-lifecycle`. Prisma users must copy or sync
the updated `PayablePayment` model and run their normal Prisma migration workflow. Existing rows get
`capturedAmount = 0`; both authorization timestamps are nullable.
