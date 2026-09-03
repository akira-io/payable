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
});
```

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
  cursor: await reconciliationStore.load(providerPaymentId),
});

if (result.outcome === 'retry') {
  await reconciliationStore.save(providerPaymentId, result.cursor);
  await scheduler.enqueue(providerPaymentId, result.cursor.nextAttemptAt);
} else {
  await reconciliationStore.finish(providerPaymentId, result);
}
```

Persist the returned cursor before scheduling its next execution. The cursor is plain JSON and
contains the provider payment ID, completed attempt count, next eligible execution time, and last
observed provider and canonical states. A new process can pass a JSON-round-tripped cursor back to
the provider without any in-memory state. Calling before `nextAttemptAt`, changing the transaction
ID, or passing a malformed cursor fails before a network request.

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
