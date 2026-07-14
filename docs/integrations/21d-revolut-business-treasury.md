# Revolut Business Treasury Provider

`RevolutBusinessTreasuryProvider` adapts the Revolut Business API to Payable's separate
`TreasuryProvider` contract. It does not implement `PaymentProvider` and does not change the Merchant
API behavior of `RevolutProvider`.

The adapter uses Node's `fetch` and has no Revolut SDK dependency.

## Configuration

```ts
import {
  createPayable,
  RevolutBusinessTreasuryProvider,
  RevolutProvider,
} from '@akira-io/payable';

const revolutMerchant = new RevolutProvider({
  secretKey: process.env.REVOLUT_MERCHANT_SECRET_KEY!,
  webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET!,
});

const revolutBusiness = new RevolutBusinessTreasuryProvider({
  environment: 'sandbox',
  webhookSecret: process.env.REVOLUT_BUSINESS_WEBHOOK_SECRET!,
  tokenProvider: {
    async getAccessToken() {
      return businessTokenCache.getValidAccessToken();
    },
  },
});

const payable = createPayable({
  providers: { revolut: revolutMerchant },
  treasuryProviders: { revolut: revolutBusiness },
});
```

The options are:

- `tokenProvider` - required source of a valid Business API access token.
- `environment` - `production` by default; use `sandbox` for the Revolut Business sandbox.
- `baseUrl` - optional endpoint override for tests or controlled proxies.
- `fetch` - optional injected HTTP client. Production uses Node 20's global `fetch`.
- `webhookSecret` - optional at construction for compatibility, but required to verify Business
  webhook deliveries.
- `webhookToleranceMs` - defaults to five minutes for replay protection.

The production base URL is `https://b2b.revolut.com/api/1.0`. The sandbox base URL is
`https://sandbox-b2b.revolut.com/api/1.0`.

## Authentication boundary

Revolut Business access tokens depend on the application's authorization flow, certificate, JWT,
client identity, and granted scopes. Payable does not own that lifecycle. The application supplies a
`RevolutBusinessTokenProvider`:

```ts
interface RevolutBusinessTokenProvider {
  getAccessToken(): string | Promise<string>;
}
```

The provider resolves a token before every HTTP request, which lets the application renew or rotate
tokens without reconstructing the Treasury provider. Empty tokens and token-provider failures become
`PROVIDER_AUTH_FAILED`. Serialization and Node inspection expose only the provider name.

Account, transaction, counterparty, and rate reads require an access token with the corresponding
read permission. Transfers and exchange also require payment permission. Payable does not expand the
token's scopes.

## Capabilities

| Capability | Revolut Business operation |
| --- | --- |
| `accounts` | List and retrieve business accounts. |
| `transactions` | List filtered transactions and retrieve one transaction. |
| `transfers` | Move funds between owned accounts or pay an existing counterparty. |
| `counterparties` | List and retrieve existing counterparties. |
| `exchange` | Quote and execute currency exchange. |
| `webhooks` | Verify and normalize Business API v2 events. |

All six capability guards return `true` for this provider.

## Money units

Payable `Money` always uses integer minor units. Revolut Business amounts use major units.

```ts
Money.of(1025, 'GBP') // Payable: 1,025 pence
// Revolut Business request: 10.25 GBP
```

Responses are converted back to minor units with the registered currency exponent. The adapter
supports decimal-base currencies known by `CurrencyManager`; unsupported currencies fail before a
request or DTO is returned.

## Accounts and transactions

`listTreasuryAccounts` calls `GET /accounts` and applies the requested limit locally because the
endpoint is not paginated. Account states map as follows:

| Revolut | Payable |
| --- | --- |
| `active` | `open` |
| `inactive` | `inactive` |
| unknown value | `unknown` |

The Business account response exposes one current balance. `available`, `inboundPending`, and
`outboundPending` are `null` because the endpoint does not split those balance buckets.

`listTreasuryTransactions` calls `GET /transactions` with the account id, optional `from` and `to`
timestamps, and a count capped at 1,000. Transaction legs preserve account ids, counterparty ids,
amounts, fees, balances, currencies, and descriptions.

| Revolut transaction state | Payable state |
| --- | --- |
| `created`, `pending` | `pending` |
| `completed` | `completed` |
| `declined`, `failed` | `failed` |
| `reverted` | `reversed` |
| unknown value | `unknown` |

## Transfers

Owned-account destinations use `POST /transfer`:

```ts
import { isTreasuryTransferCapable, Money } from '@akira-io/payable';

const provider = payable.treasuryProviders().get('revolut');
if (isTreasuryTransferCapable(provider)) {
  await provider.createTreasuryTransfer(
    {
      sourceProviderAccountId: 'source-account-id',
      destination: { type: 'account', providerAccountId: 'target-account-id' },
      amount: Money.of(2500, 'GBP'),
      reference: 'Reserve allocation',
    },
    { correlationId: 'corr-1', idempotencyKey: 'transfer-1' },
  );
}
```

Counterparty destinations use `POST /pay`. `providerCounterpartyId` becomes
`receiver.counterparty_id`, and an optional destination `providerAccountId` becomes
`receiver.account_id`.

Payment-method destinations are rejected with `PROVIDER_TREASURY_DESTINATION_UNSUPPORTED` before an
HTTP request. Revolut Business card-transfer requirements do not match Payable's generic payment
method identifier.

Transfer listing filters `GET /transactions` to type `transfer`. Retrieved transaction legs are used
to reconstruct the normalized source and destination. The destination can be `null` when the API
does not return a stable counterparty or target-account identifier.

## Idempotency

Revolut Business writes carry idempotency in the JSON `request_id` field. Payable uses
`OperationContext.idempotencyKey`; when it is absent, the correlation id is the fallback. Values over
the Business API's 40-character limit are replaced by a deterministic 40-character SHA-256 prefix,
so retries with the same context keep the same request id.

The Business API's idempotency retention window still applies. Applications must retain operation
context and avoid reusing a request id for a different transfer or exchange.

## Counterparties

The common capability is read-only. `listTreasuryCounterparties` caps `limit` at 1,000 and maps the
counterparty's existing accounts. Creating, updating, deleting, or validating a counterparty remains
outside the generic contract.

## Exchange

`quoteTreasuryExchange` calls `GET /rate` with the source amount and both currencies:

```ts
const quote = await provider.quoteTreasuryExchange({
  sourceAmount: Money.of(10_000, 'GBP'),
  targetCurrency: 'EUR',
});
```

`createTreasuryExchange` calls `POST /exchange`. The generic input accepts a known source amount or a
known target amount. Payable sends the amount on the matching `from` or `to` leg and rejects a
currency mismatch before the request.

## Webhooks

`verifyTreasuryWebhook` verifies the exact raw payload using the Business webhook signing secret,
`Revolut-Request-Timestamp`, and one or more `Revolut-Signature` values. The signed value is
`v1.{timestamp}.{rawPayload}` and the default timestamp tolerance is five minutes.

`TransactionCreated` and `TransactionStateChanged` normalize to Treasury transaction events.
`PayoutLinkCreated` and `PayoutLinkStateChanged` normalize to payout-link events. Unknown verified
events remain available with `normalizedType: null`.

Business payloads do not include a delivery event ID. Payable derives a stable ID by prefixing the
SHA-256 hash of the exact raw payload with `revolut-business:`. Exact retries therefore deduplicate,
and state-change events are valid even when their creation event has not arrived yet.

## Error handling

Business API errors become `PayableError` with provider context
`revolut-business-treasury`. Numeric and string Revolut error codes are preserved as
`context.revolutCode`.

| Condition | Payable code |
| --- | --- |
| HTTP 400 or 422 | `PROVIDER_REQUEST_INVALID` |
| HTTP 401 or 403 | `PROVIDER_AUTH_FAILED` |
| HTTP 409 or Revolut duplicate request code `3020` | `PROVIDER_IDEMPOTENCY_CONFLICT` |
| HTTP 429 | `PROVIDER_RATE_LIMITED` |
| Network or unmapped provider error | `PROVIDER_ERROR` |

Error context never contains the bearer token.

## Scope and limitations

- OAuth, JWT assertion, certificate handling, token storage, and token renewal belong to the
  application's `RevolutBusinessTokenProvider`.
- Counterparties are read-only through the common contract.
- The common transfer contract does not expose transfer cancellation, scheduled payments, transfer
  reason codes, or charge-bearer selection.
- Webhook endpoint registration and failed-event retrieval remain outside this provider.
- Revolut Business cards, team management, expenses, accounting, payout links, and draft payments are
  outside the Treasury contract.

## Sandbox troubleshooting

- Confirm `environment: 'sandbox'`; production tokens do not authenticate against the sandbox host.
- Confirm that the token provider returns a non-empty token for every request.
- Confirm that the access token includes read permission and payment permission for writes.
- Use a new idempotency key for a new operation. Duplicate request code `3020` means the request id was
  already used.
- Pass amounts to Payable in minor units. `Money.of(1000, 'GBP')` sends `10.00`, not `1000.00`.

## Source reference

The adapter follows the GA Business OpenAPI specification published by
`revolut-engineering/revolut-openapi`, including accounts, transactions, counterparties, transfers,
rates, exchange, bearer authentication, and body-level request ids.

---

[Revolut Merchant Provider](21-revolut.md) · [Treasury Providers](17a-treasury-providers.md) · [Index](../00-index.md)
