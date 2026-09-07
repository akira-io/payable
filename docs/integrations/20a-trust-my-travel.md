# Trust My Travel

`TrustMyTravelProvider` integrates Payable with the Trust My Travel Payment Modal, booking API,
browser callback reconciliation, CardVaulter payment-method setup, retained purchases, and
transaction refunds. It does not declare customers, catalog, subscriptions, webhooks, disputes, or
billing portal capabilities.

## Server-only configuration

> **Never instantiate `TrustMyTravelProvider` in browser code.** The API token and channel secret
> authorize operations on the configured channel. Keep both values in server-side secret storage
> and return only the generated checkout result to the browser.

Each TMT channel has one base currency. Register a separate provider instance for each channel:

```ts
import { createPayable, Money, TrustMyTravelProvider } from '@akira-io/payable';

const trustMyTravel = new TrustMyTravelProvider({
  path: process.env.TMT_SITE_PATH!,
  apiToken: process.env.TMT_API_TOKEN!,
  channelId: 2452,
  channelSecret: process.env.TMT_CHANNEL_SECRET!,
  vaultReferenceSecrets: [process.env.TMT_VAULT_REFERENCE_SECRET!],
  currency: 'EUR',
  environment: 'test',
});
const payable = createPayable({
  providers: {
    'tmt-eur': trustMyTravel,
  },
  storage,
});
```

The provider declares `checkout`, `refunds`, `charges`, `paymentMethodSetup`, and the provider
extension `x-tmt-bookings`.
`subscriptionOperationCapabilities()` returns no supported subscription operations.

`vaultReferenceSecrets` is a server-only keyring independent of the API token. Generate each secret
from at least 32 random bytes. The first entry encrypts new references; retain previous entries while
stored references still exist so key rotation can decrypt them. If omitted for compatibility, the
channel secret is used, so rotating that secret invalidates existing references.

## CardVaulter payment-method setup

CardVaulter is a hosted setup presentation. Create it only on the server:

```ts
const provider = payable.providers().get('tmt-eur');
if (
  !isPaymentMethodSetupCapable(provider) ||
  !isPaymentMethodSetupConfirmationCapable(provider)
) {
  throw new Error('TMT CardVaulter is unavailable');
}

const setup = await provider.createPaymentMethodSetup(
  {
    providerCustomerId: customer.id,
    usage: 'off_session',
    currency: 'EUR',
    returnUrl: 'https://api.example.test/payment-methods/tmt/return',
  },
  operationContext,
);
```

`checkoutUrl` points to the pinned CardVaulter 1.8.0 application. It contains a dedicated card-vault
JWT with a maximum lifetime of 15 minutes. That JWT can create the vault verification transaction;
it is not the API token. The URL never contains the API token, channel secret, or CVV. The browser
may present the URL and relay the provider return string, but must not surface its provider fields as
the application's payment-method contract.

The return `status`, card fields, and transaction identifier are hints. Confirm them on the server:

```ts
const confirmed = await provider.confirmPaymentMethodSetup({
  providerSetupId: setup.providerSetupId,
  providerReturn: request.url.search.slice(1),
});
```

Payable checks the setup session, reads the referenced transaction through the authenticated TMT
API, compares the returned card token with the authoritative token without exposing either, and
accepts only a complete, zero-value `vault` transaction in the expected channel and currency.
`providerPaymentMethodId` is then an encrypted, authenticated Payable reference. It does
not reveal TMT's `transaction_id` or card token. The optional `paymentMethod` summary contains only
the authoritative brand and last four digits. Expiry is `null` because the transaction API does not
confirm the expiry values supplied in the browser return.

API services such as Bu-Payment/api #260 can encrypt and persist this opaque
`providerPaymentMethodId` behind their own App-scoped public identifier. Browser clients receive the
setup presentation and the API-owned identifier, never the opaque provider reference or the raw TMT
identifier.

CardVaulter itself collects the CVV and does not vault it. Payable has no CVV field and rejects
retained-purchase provider data containing anything other than booking allocations.
Because TMT exposes no authoritative setup lookup by session, retrieval returns `unknown` until the
return is confirmed. TMT also exposes no CardVaulter session cancellation endpoint, so cancellation
fails explicitly instead of claiming that the hosted URL was revoked.

## Retained purchases

Use the confirmed opaque reference for merchant-initiated charges. TMT requires explicit booking
allocations, and Payable requires persistent idempotency plus a non-empty reference because TMT does
not offer native idempotency for this mutation.

```ts
await payable.customer(billable, 'tmt-eur').charge({
  amount: Money.of(5000, 'EUR'),
  reference: 'renewal-2026-09',
  paymentMethodId: encryptedProviderReference,
  offSession: true,
  providerData: {
    bookings: [{ id: bookingId, currencies: 'EUR', total: 5000 }],
  },
});
```

The provider decrypts the reference only in the TMT adapter, re-reads the original vault transaction,
and audits `/category-one-declines` filtered by the vault transaction before posting. The retained request contains only `channels`,
`currencies`, `total`, `transaction_types`, `bookings`, and the internal `linked_id`. No PSP, TMT card
token, card data, or CVV is sent.

A reference may move to another configured TMT channel only when both channels use the same currency
and account type. A category-one decline permanently invalidates the vaulted method; subsequent
attempts stop before any retained-purchase mutation. Failed non-native mutations enter
reconciliation-required idempotency state without expiry and are not retried automatically.

The deterministic implementation follows the current TMT CardVaulter contract. The opt-in Test
workflow verifies only channel readiness and dedicated JWT/URL acquisition. Browser presentation, vault completion, and a
retained purchase with the protected-processing Test channel while `server_to_server=false` still
require an externally enabled, run-owned test card flow. Do not infer Live readiness from unit tests
or from successful token acquisition.

## Payment Modal checkout

The amount-based redirect checkout creates a TMT booking or reuses an existing one, generates the
short-lived authentication string on the server, and returns HTML configured for the pinned Payment
Modal script. Payer data travels through `providerData`; Payable core forwards it without assigning
travel semantics to the canonical contract.

```ts
const session = await payable
  .customer(billable, 'tmt-eur')
  .redirectCheckout(Money.of(9999, 'EUR'))
  .create({
    reference: 'ORDER-42',
    providerData: {
      booking: {
        firstname: 'Jane',
        surname: 'Doe',
        email: 'jane@example.org',
        date: '2030-05-12',
        countries: 'PT',
      },
      modal: {
        payee_name: 'Jane Doe',
        payee_email: 'jane@example.org',
        payee_address: '1 Main Street',
        payee_city: 'Lisbon',
        payee_postcode: '1000-001',
        payee_country: 'PT',
      },
    },
  });

// Render session.html in the browser.
```

Use `providerData.bookingId` instead of `providerData.booking` to pay a deposit or remaining balance
against a preloaded booking. Payable confirms the booking belongs to the configured channel and
currency and that the requested amount does not exceed `total_unpaid` before rendering the modal.

The default script is pinned to `tmt-payment-modal.3.6.1.js`. `modalVersion` may select another
explicit semantic version. The returned HTML contains a short-lived `booking_auth`, never the
channel secret or API token.

The generated HTML waits for `window.tmtPaymentModalReady`, stores the modal instance at
`window.buPaymentTrustMyTravelModal`, and dispatches `bu-payment:tmt-modal-ready`. Register the
modal event handlers before rendering the HTML:

```ts
window.addEventListener('bu-payment:tmt-modal-ready', (event) => {
  const modal = (event as CustomEvent).detail;
  modal.on('transaction_logged', relayToApplicationBackend);
  modal.on('transaction_failed', relayToApplicationBackend);
  modal.on('transaction_result_available', relayToApplicationBackend);
  modal.on('transaction_error', relayToApplicationBackend);
});
```

`transaction_error` is the only one of these whose payload resolves against nothing: the others
carry an id that Payable reads back from the authoritative API, and it carries an error envelope
that names no resource. Relay it to your backend like the rest, and have the backend supply the
checkout session from its own checkout record, as described under "Attempts that never became a
transaction".

## Browser callback relay

Trust My Travel does not send a server webhook. The Payment Modal emits JavaScript events in the
customer's browser, so the consuming application must relay the event payload to its own backend.
That backend calls Payable:

```ts
const result = await payable.receiveRedirectCallback({
  provider: 'tmt-eur',
  payload: modalEventData,
});
```

For `transaction_logged` and `transaction_failed`, relay `{ id, status, total, hash }`. Payable
checks the hash in constant time before making any request, then confirms the authoritative state
with `GET /transactions/{id}`. For `transaction_result_available`, relay its id-only payload;
Payable retrieves the private API result and validates its channel and currency. A pending local
payment initially uses the booking ID and is rebound atomically to the transaction ID when the
result is reconciled.

`transaction_timeout` supplies a booking ID rather than a transaction result. The application can
use `trustMyTravel.bookings.find(bookingId)` to inspect the booking and decide when to retry
reconciliation. Do not treat a timeout as payment success.

TMT statuses map as follows: `complete -> succeeded`, `failed -> failed`, `pending -> processing`,
and `expired -> failed`. `locked` throws `PROVIDER_TRANSACTION_LOCKED`; `incomplete` throws
`PROVIDER_RESULT_UNKNOWN` because neither has an honest canonical payment state.

## Attempts that never became a transaction

The Payment Modal splits an attempt that did not succeed across two events, and they mean different
things. `transaction_failed` is the card issuing bank rejecting the card: a transaction row exists,
so the payload is a signed `{ id, status, total, hash }` and Payable resolves it through
`GET /transactions/{id}` on the path above. `transaction_error` is the modal's own words for an
attempt that failed "due to connectivity issues with the card issuing bank or for any reason other
than being rejected ... [by] the card issuing bank's criteria". No transaction exists, so the
relayed payload is the WordPress REST error envelope and carries neither an `id` nor a `hash`:

```json
{ "code": "auth_invalid", "message": "Invalid API token", "data": { "status": 403 } }
```

An acquirer decision is not what this envelope carries. It is what an expired account token, a rate
limit, a wrong channel, a malformed transaction body or an upstream outage look like, and none of
them mean the card was charged or refused - they mean the charge was never attempted.

Nothing in that payload identifies the booking, and nothing in it can be authenticated. Payable
therefore never reports a payment outcome from it. Pass the checkout session the callback arrived
for so the provider can name the booking in what it raises:

```ts
const result = await payable.receiveRedirectCallback({
  provider: 'tmt-eur',
  checkoutSessionId: providerCheckoutId,
  payload: modalEventData,
});
```

That call always throws `PROVIDER_TMT_CALLBACK_FAILURE_UNCONFIRMED`, whatever status a recognised
envelope carries,
and records nothing. `verifyCallback` returning `true` for this shape is not proof of anything: on
the signed path it means the hash checked out, here it means only that the envelope is well formed
and a session accompanies it. No booking request is made, so a relayed error costs one
classification rather than one API call. The refusal is logged with the provider `code` and the
status before the error is raised; `PROVIDER_TMT_INVALID_CALLBACK` is not logged and its context
carries neither.

> **`checkoutSessionId` must be derived on the server.** Resolve it from your own checkout record,
> keyed by whatever secret the browser already proves it holds. It is a Trust My Travel booking id,
> a small sequential integer, so a caller who supplies it directly can name any booking on the
> channel, and the modal config already ships it to that browser as `booking_id`. Payable cannot
> tell a server-derived value from a relayed one: authenticating the callback endpoint and binding
> the session to the request is the consuming application's job.

**Why no status is treated as a decision.** An earlier revision reported `failed` for every 4xx, and
a narrower one for `402` alone. Both were wrong for the same reason. Trust My Travel does not
publish the statuses or codes the Payment Modal emits on this event, no envelope has ever been
captured from it into this repository, and a decision would in any case have to reach the acquirer
before Trust My Travel logged a transaction row - which the booking would then show, so confirming
against the booking could not have worked either. Classifying on a value with no observed meaning
turned an expired token into a failed payment that never existed.
`20b-trust-my-travel-test-certification.md` records the capture that would establish whether a
decision can arrive here at all. Until it does, an attempt relayed through this event is unresolved,
never failed.

A `checkoutSessionId` that is not a positive decimal integer does not even reach that refusal.
Without it the envelope has no session to name and is indistinguishable from an unsigned callback,
so `verifyCallback` returns `false` and `receiveRedirectCallback` raises `REDIRECT_CALLBACK_INVALID`
before the provider is consulted. Calling `handleRedirectCallback` directly raises the provider's
own `PROVIDER_TMT_INVALID_CALLBACK`; through the documented entry point you will see the former.

`context.providerStatus` on the raised `PayableError` is the only thing that separates two opposite
risks. A 4xx means nothing was attempted; a 5xx means the card may already have been charged. A host
that treats them the same will either chase settled charges or ignore them.

An unconfirmed attempt is not a failed one. Leave the payment pending and resolve it out of band:
recurring reconciliation cannot help here, because it is keyed by `providerPaymentId` and an
attempt that never settled has no transaction id to give it. A payment whose `providerPaymentId` is
still the booking id is resolved by `payable.reconcileUnsettledCheckout(...)`, described under
[Unsettled checkout reconciliation](#unsettled-checkout-reconciliation).

Only the WordPress REST envelope is recognised: a non-empty `code` string, a `message` string and an
integer `data.status` between 400 and 599, with no `id`, `hash` or top-level `status`. A
`transaction_timeout` payload (`{ name, message, booking_id }`) and a relayed JavaScript error
(which serialises to `{}`) are deliberately not recognised - neither states that the attempt failed,
and the empty object is indistinguishable from noise.

A token that expires mid-checkout is the case this rule exists for. It produces a `403` envelope
against an untouched booking, and an untouched booking is exactly what a decline that settled
nothing would also leave behind. The booking cannot separate them, which is why it is no longer
consulted here at all.

Passing that booking id to recurring reconciliation instead is refused rather than guessed at, with
`PROVIDER_TMT_RECONCILIATION_BOOKING_UNSETTLED`. Booking ids and transaction ids are both small
sequential integers on the same channel, so a booking id reaches a real transaction often enough to
matter, and that transaction belongs to whichever buyer happens to hold it. A partly paid booking
makes it worse: the deposit transaction of this very booking is a legitimate transaction of the
wrong payment. Recurring reconciliation below describes what the provider requires to tell the two
apart, and unsettled checkout reconciliation after it describes where such a payment does get
resolved.

## Recurring transaction reconciliation

Browser callbacks are only hints that a transaction may be ready. They cannot report a customer who
abandons 3DS, an empty gateway response, expiry cleanup, or a later chargeback. Run recurring
reconciliation in a server worker for every TMT payment that remains unresolved. The provider makes
one authoritative `GET /transactions/{id}` request per invocation.

The optional provider capability keeps persistence and scheduling in the host application:

```ts
import { isRecurringPaymentReconciliationCapable } from '@akira-io/payable';

const provider = payable.providers().get('tmt-eur');
if (!isRecurringPaymentReconciliationCapable(provider)) {
  throw new Error('The provider cannot reconcile recurring payment state');
}

const result = await provider.reconcilePaymentRecurring({
  providerPaymentId,
  providerData: { bookingId },
  cursor: await reconciliationStore.load(providerPaymentId),
});

if (result.outcome === 'retry') {
  await reconciliationStore.save(providerPaymentId, result.cursor);
  await scheduler.enqueue(providerPaymentId, result.cursor.nextAttemptAt);
} else {
  await reconciliationStore.finish(providerPaymentId, result);
}
```

`providerData.bookingId` is required, and it is what binds the read to this payment.
`providerPaymentId` carries no marker of which identifier space it belongs to: a redirect payment
holds the booking id until a settled result relinks it to the transaction id, and both spaces are
small sequential integers on the same channel. Two refusals follow from that, both before anything
is applied to the payment:

- `PROVIDER_TMT_RECONCILIATION_BOOKING_UNSETTLED`, raised before any request, when
  `providerPaymentId` still equals the booking id. Nothing has settled for this payment, so there is
  no transaction to read; resolve it through `payable.reconcileUnsettledCheckout(...)`, described
  under [Unsettled checkout reconciliation](#unsettled-checkout-reconciliation). This is what stops
  a stuck payment from adopting the state of whatever
  transaction happens to carry the booking's number, including the deposit transaction of its own
  booking.
- `PROVIDER_TMT_TRANSACTION_BOOKING_MISMATCH`, raised after the read, when the transaction does not
  list the booking. A response that is not readable at all - no status, or no `bookings` array -
  raises `PROVIDER_TMT_TRANSACTION_RESPONSE_INVALID` instead, so the mismatch code always means what
  it says rather than doubling as a parse failure.

A missing `bookingId` raises `PROVIDER_TMT_RECONCILIATION_BOOKING_REQUIRED`, and one that is not a
positive integer raises `PROVIDER_TMT_BOOKING_ID_INVALID`, the same code the checkout path uses for
the same mistake. Both are raised before any request.

> **`bookingId` must come from your own payment record.** Resolve it from the checkout you created,
> never from the request being handled. The provider can only check that the transaction it read
> settled the booking you named; a `bookingId` taken from a webhook body, a return URL or a
> re-enqueued job payload lets whoever supplied it choose which booking the payment is bound to, and
> reopens exactly the confusion this parameter exists to prevent.

Where to find it: for a redirect payment it is the `id` that `createCheckoutSession` returned, which
is the booking id. For a retained purchase it is the `id` of any element of the
`providerData.bookings` you charged - proving one booking is enough to prove the transaction is this
payment's, and a multi-booking purchase does not need all of them. For a payment whose
`providerPaymentId` now names a capture, void or refund transaction, it is still the booking of the
original checkout: those transactions carry the same booking allocations forward. Do not take it
from the `checkoutSessionId` a callback returned - that field carries the linked authorization's
transaction id whenever the transaction is not itself an authorization.

Persist the returned cursor before scheduling its next execution. The cursor is plain JSON and
contains the provider payment ID, completed attempt count, next eligible execution time, and last
observed provider and canonical states. A new process can pass a JSON-round-tripped cursor back to
the provider without any in-memory state, but the cursor does not carry the booking: pass
`providerData.bookingId` on every invocation, restored from the payment record rather than from the
cursor. Calling before `nextAttemptAt`, changing the transaction ID, or passing a malformed cursor
fails before a network request.

The default policy allows 35 GET attempts, starts at one minute, doubles the delay, and caps each
delay at 24 hours. Override it when constructing the provider:

```ts
import type { TrustMyTravelReconciliationOptions } from '@akira-io/payable';

const reconciliation = {
  maxAttempts: 20,
  baseDelayMs: 30_000,
  maxDelayMs: 3_600_000,
} satisfies TrustMyTravelReconciliationOptions;
```

Pass `reconciliation` with the server-only provider options shown above.

`complete`, `failed`, and `expired` return `terminal` with `succeeded`, `failed`, and `failed`
respectively. `pending` returns `retry` with `processing`. `incomplete` and `locked` return `retry`
with canonical `pending`: neither is forced into a misleading success or failure. If the last
allowed GET is still unresolved, `exhausted` preserves the final observation and reports
`attempt_limit`; it does not fabricate a terminal payment state.

Transport and API errors reject the invocation and return no replacement cursor, so the host keeps
its last durable cursor. Repeating an invocation with the same cursor is safe from Payable's side:
it performs a read only and derives the same attempt number. The host should still use a durable
claim or compare-and-set when multiple workers may process the same record.

Locked responses expose the current `chargebackStatus`, `outcomeStatus`, `reasonCode`, and
`challengeDate` under `providerData`. These values come from the private GET, never from the browser.
Long-lived chargeback monitoring may start fresh bounded reads for settled transactions according to
the host's retention policy; a browser return page is never required for that observation.

## Unsettled checkout reconciliation

Recurring reconciliation answers for a payment that has a transaction. A redirect payment whose
attempt never settled has none: its `providerPaymentId` is still the booking id, and
`PROVIDER_TMT_RECONCILIATION_BOOKING_UNSETTLED` is what recurring reconciliation raises for it. This
is where those payments are resolved, keyed by the checkout session rather than by a transaction:

```ts
const result = await payable.reconcileUnsettledCheckout({
  provider: 'tmt-eur',
  tenantId,
  checkoutSessionId,
});

if (result.outcome === 'unsettled' && result.paymentUpdated) {
  // the payment is now failed and the checkout can be reopened
}
```

The stored payment is located first, by `checkoutSessionId` within `tenantId`, and the provider is
only consulted once it is found. A `checkoutSessionId` that no payment of yours carries raises
`CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND` before any request leaves the process, so the operation
never reports what a booking holds to a caller who does not own the payment behind it. Booking ids
are small sequential integers on one channel, and this ordering is what stops the result from
answering questions about the rest of it. Pass `tenantId` explicitly on a multi-tenant host: a
payment is only ever matched against the tenant you name.

The provider then reads `GET /bookings/{checkoutSessionId}`, checks the response carries the booking
that was asked for and that it belongs to the configured channel and currency, and reports one of
two things. `unsettled` when the booking still shows `transaction_ids: []` and
`total_unpaid === total`: nothing was ever collected, so the payment is closed as `failed`.
`settled` when the booking carries transactions, and then it returns their ids in
`providerPaymentIds` and writes nothing.

`settled` is an observation about the booking, not a verdict on your payment, and the difference
matters on a booking paid in stages. The ids are every transaction the booking carries, including
ones that belong to a different payment against it - a deposit already reconciled by its own
callback, for instance. Do not feed them to recurring reconciliation to resolve this payment: that
operation only checks that the transaction belongs to the booking, which a sibling payment's
transaction also does, and it would adopt its state. Treat `settled` as a signal to look at the
booking yourself.

The failure callback once applied these same two conditions and deliberately no longer does. There
the envelope claims a decision was made, and an untouched booking cannot separate a real decline
from an expired account token, because a decision that reached the acquirer would have left a
transaction row. Here nothing claims a decision at all, so a booking that collected nothing is the
whole of the evidence. This path also does not need a browser to come back, which is exactly what a
payment abandoned mid-attempt never gets.

Only a `pending` payment is closed. The row is re-read for update inside the transaction, and the
write is abandoned with `paymentUpdated: false` if it has since moved on, if its `providerPaymentId`
is no longer the booking id, or if the compare-and-set on the status loses to a concurrent writer.
That covers the callback that arrives while the booking is being read: it leaves the payment
`authorized` or `succeeded`, and this operation will not overwrite either. The status is the only
column written, guarded by its previous value, and the change is recorded in the audit log as
`payment.checkout_unsettled` under the payment's own tenant.

The booking must cover the payment: same currency, and an amount no smaller than the payment's, or
`CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH` is raised and nothing is recorded. It is a coverage
check, not an equality one, because a deposit or balance checkout is worth less than the booking it
is drawn against, and requiring equality would leave those payments impossible to close.

Four refusals carry no state change. `PAYMENT_STORAGE_REQUIRED` is raised when no storage driver is
configured, since there would be nothing to reconcile against.
`CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND` is raised when no payment of this tenant carries the
session id. `PROVIDER_TMT_CHECKOUT_SESSION_INVALID` is raised, before any request, when
`checkoutSessionId` is not a positive decimal integer, since it must be a booking id.
`PROVIDER_TMT_BOOKING_SETTLEMENT_UNCLEAR` is raised when the booking reports no transactions and yet
claims to be partly paid: the two statements contradict each other, and a booking that cannot say
plainly that it collected nothing is not evidence that the payment failed.

Two more come from the booking read itself. `PROVIDER_TMT_BOOKING_ID_MISMATCH` is raised when the
response carries a different booking than the one requested, so a merged or redirected booking
cannot close the wrong payment. `PROVIDER_TMT_BOOKING_SCOPE_MISMATCH` is raised when the booking
belongs to another channel or currency.

Nothing here decides that a payment is old enough to give up on. The provider has no idea when the
checkout was created or how long your modal session lasts, so it reports only what the booking says
and leaves the timing to you. Find the candidates with the canonical payment list, which takes
`createdBefore` for exactly this:

```ts
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const stale = await payable.storedPayments(tenantId).list({
  status: 'pending',
  createdBefore: cutoff,
  limit: 100,
});
```

Hold that `cutoff` fixed across the whole sweep. It is part of the cursor context, so recomputing it
per page invalidates the cursor you were paging with. Walk the results sequentially rather than
fanning out: each reconciliation appends to the tenant's audit chain, whose tail is a single row
that parallel writers queue behind.

Callers who were resolving these payments by hand through `trustMyTravel.bookings.find(bookingId)`
can drop that code. The booking read, the channel and currency check, the settlement decision and
the canonical write are all done here, and the raw booking API no longer has to be reached for this.

## Refunds

`payable.refund(...)` reads the original TMT transaction before creating a refund. This recovers the
channel and booking allocations and checks `total_remaining`. Full and partial refunds are
supported. Currency mismatches and amounts above the provider remainder fail before the refund POST.

For a transaction containing one booking, Payable assigns the refund amount to that booking. A
partial refund across multiple bookings must provide explicit, unique allocations whose total
equals the refund amount:

```ts
await payable.refund({
  paymentId,
  amount: Money.of(5000, 'EUR'),
  providerData: {
    bookings: [
      { id: 44, currencies: 'EUR', total: 3000 },
      { id: 45, currencies: 'EUR', total: 2000 },
    ],
  },
});
```

Refunds that reverse custom transaction allocations or statement dates are not supported by this
adapter.

---

[Previous: SISP](20-sisp.md) · [Index](../00-index.md) · [Next: Credentials](20c-trust-my-travel-credentials.md)
