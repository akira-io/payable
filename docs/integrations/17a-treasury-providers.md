# Treasury Providers

Treasury integrations use a contract and registry separate from `PaymentProvider`. Payment checkout,
billing, and refunds remain in `providers`; financial accounts, banking transactions, transfers,
counterparties, and exchange live in `treasuryProviders`.

```ts
const payable = createPayable({
  providers: { stripe },
  treasuryProviders: {
    banking: treasuryProvider,
  },
});

const provider = payable.treasuryProviders().get('banking');
```

`providers` remains required. `treasuryProviders` is optional, and an omitted map produces an empty
`TreasuryProviderRegistry`. An unknown name throws `TreasuryProviderNotFoundError` with code
`TREASURY_PROVIDER_NOT_FOUND`.

## Base contract

Every Treasury adapter implements only the identity and capability set:

```ts
interface TreasuryProvider {
  readonly name: string;
  capabilities(): TreasuryCapabilities;
}
```

The common capability names are `accounts`, `transactions`, `transfers`, `counterparties`, `exchange`,
and `webhooks`. As with payment providers, the set remains open for custom provider capabilities.

## Optional capabilities

| Interface | Operations |
| --- | --- |
| `TreasuryAccountCapable` | List and retrieve financial accounts and normalized balances. |
| `TreasuryTransactionCapable` | List account transactions and retrieve one transaction. |
| `TreasuryTransferCapable` | Create, list, and retrieve transfers. |
| `TreasuryCounterpartyCapable` | List and retrieve existing counterparties. |
| `TreasuryExchangeCapable` | Quote and execute currency exchange. |
| `TreasuryWebhookCapable` | Verify signatures and normalize Treasury events. |

Each interface has a structural `isTreasuryXCapable` guard. A provider implements only the
operations it can honor; for example, a provider can expose accounts and transactions without
claiming counterparty or exchange support.

## Boundary DTOs

Treasury contracts expose Payable DTOs and `Money`, never a provider SDK type.

- Account balances distinguish current, available, inbound-pending, and outbound-pending amounts.
  Unsupported balance components are `null`.
- Transactions contain one or more normalized legs so multi-account and cross-currency activity is
  not flattened.
- Transfer destinations are discriminated as another account, a payment method, or a counterparty.
  Retrieved transfers use `null` when the provider does not return a stable destination identifier.
- Transaction and transfer lifecycle states use `pending`, `completed`, `failed`, `canceled`,
  `reversed`, or `unknown`.
- Exchange creation accepts either a known source amount or a known target amount, but not both.

`OperationContext.idempotencyKey` is available on transfer and exchange writes. Each adapter forwards
it through the provider's supported idempotency mechanism.

Treasury contracts do not add local storage or billing-engine actions. Applications call a selected
Treasury provider explicitly after narrowing it with the relevant guard.

## Treasury webhooks

`TreasuryWebhookCapable` receives the exact raw request body, signature, and optional headers through
`WebhookVerificationInput`. Signature verification and provider-specific normalization happen inside
the adapter and return `VerifiedTreasuryWebhook`.

The normalized event vocabulary covers account, transaction, transfer, exchange, and payout-link
lifecycle changes. Unknown provider events remain valid verified deliveries with
`normalizedType: null`; consumers can store or ignore them without treating them as signature errors.
When supplied by the provider, `occurredAt` is persisted and retained through queue retries. The same
timestamp is exposed on `treasury.webhook.processed` and serialized into normalized Treasury outbox
payloads; absent provider timestamps remain `null` in storage and outbox payloads.

Payment and Treasury webhook contracts remain separate. Implementing `WebhookCapable` does not make a
provider `TreasuryWebhookCapable`, and Treasury events do not enter payment reconciliation pipelines.
Stripe Treasury advertises `webhooks` after verifying signatures with the Stripe SDK and normalizing
account, transaction, Outbound Payment, and Outbound Transfer events. Revolut Business verifies its
independent HMAC signature and normalizes transaction and payout-link events.

---

[Payment Providers](17-providers.md) · [Index](../00-index.md)
