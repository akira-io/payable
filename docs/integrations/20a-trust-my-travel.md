# Trust My Travel

`TrustMyTravelProvider` integrates Payable with the Trust My Travel Payment Modal, booking API,
browser callback reconciliation, and transaction refunds. It supports one-time checkout only. It
does not declare customers, catalog, subscriptions, charges, webhooks, disputes, or billing portal
capabilities.

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

The provider declares `checkout`, `refunds`, and the provider extension `x-tmt-bookings`.
`subscriptionOperationCapabilities()` returns no supported subscription operations.

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

[Previous: SISP](20-sisp.md) · [Index](../00-index.md) · [Next: Revolut](21-revolut.md)
