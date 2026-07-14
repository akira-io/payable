# Stripe Treasury Provider

`StripeTreasuryProvider` adapts Stripe Treasury to Payable's separate `TreasuryProvider` contract.
It does not implement `PaymentProvider` and does not change `StripeProvider` billing behavior.

Install `stripe` as an optional peer before using either Stripe adapter:

```bash
npm install stripe
```

## Configuration

```ts
import {
  createPayable,
  StripeProvider,
  StripeTreasuryProvider,
} from '@akira-io/payable';

const stripe = new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});

const stripeTreasury = new StripeTreasuryProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  connectedAccountId: process.env.STRIPE_CONNECTED_ACCOUNT_ID!,
  webhookSecret: process.env.STRIPE_TREASURY_WEBHOOK_SECRET!,
});

const payable = createPayable({
  providers: { stripe },
  treasuryProviders: { stripe: stripeTreasury },
});
```

`connectedAccountId` is required. Every Treasury SDK request forwards it as Stripe's
`stripeAccount` request option. The SDK remains dynamically imported on first use, and the shared
pinned API version is used by both Stripe providers. `webhookSecret` is optional for backwards
compatibility but required before calling `verifyTreasuryWebhook`.

## Capabilities

| Capability | Support |
| --- | --- |
| `accounts` | List and retrieve Financial Accounts. |
| `transactions` | List account transactions and retrieve one transaction. |
| `transfers` | Create, list, and retrieve Outbound Transfers. |
| `webhooks` | Verify and normalize Stripe Treasury events. |
| `counterparties` | Not supported by Stripe Treasury. |
| `exchange` | Not supported by Stripe Treasury. |

## Accounts and balances

Financial Account balance buckets map as follows:

| Stripe field | Payable field |
| --- | --- |
| `cash` | `available` |
| `inbound_pending` | `inboundPending` |
| `outbound_pending` | `outboundPending` |
| Sum of all three buckets | `current` |

Balances preserve each supported currency. Stripe `open` and `closed` account states map directly;
the provider returns `updatedAt: null` because Financial Accounts do not expose that timestamp.

## Transactions

`listTreasuryTransactions` requires `providerAccountId` and accepts optional `from`, `to`, and
`limit` filters. Stripe timestamps are converted to `Date`, and Stripe transaction states map to:

- `open` -> `pending`
- `posted` -> `completed`
- `void` -> `canceled`

Each Stripe transaction becomes one normalized transaction leg. The flow type remains available in
`TreasuryTransactionDTO.type`.

## Transfers

`createTreasuryTransfer` selects the Stripe money-movement resource from the destination:

- `{ type: 'account', providerAccountId }` uses an Outbound Transfer to another Stripe Financial
  Account.
- `{ type: 'payment_method', providerPaymentMethodId }` uses an Outbound Payment to a third party.

Counterparty destinations are rejected with `PROVIDER_TREASURY_DESTINATION_UNSUPPORTED` before an API
call because Stripe has no counterparty object matching the common destination identifier.

```ts
import { isTreasuryTransferCapable, Money } from '@akira-io/payable';

const provider = payable.treasuryProviders().get('stripe');
if (isTreasuryTransferCapable(provider)) {
  await provider.createTreasuryTransfer(
    {
      sourceProviderAccountId: 'fa_source',
      destination: { type: 'account', providerAccountId: 'fa_destination' },
      amount: Money.of(2500, 'USD'),
      reference: 'Reserve allocation',
    },
    { correlationId: 'corr-1', idempotencyKey: 'transfer-1' },
  );
}
```

The operation idempotency key is forwarded as Stripe's `idempotencyKey`. List operations query both
Outbound Transfers and Outbound Payments, combine them in reverse creation order, and enforce the
requested total limit. Each Stripe request remains bounded to the 100-object page size. Retrieval
routes `obp_` ids to Outbound Payments and other ids to Outbound Transfers. Stripe errors use the same
normalized `PayableError` mapping as `StripeProvider`. Historical movements created with inline
destination data can omit the PaymentMethod id; those records return `destination: null`.

## Webhooks

`verifyTreasuryWebhook` passes the exact raw payload, Stripe signature, and configured Treasury
webhook secret to `webhooks.constructEventAsync`. Invalid signatures throw
`InvalidWebhookSignatureError` with provider `stripe-treasury`.

Connect events must identify the same account configured by `connectedAccountId`; events signed for
a different connected account are rejected. Accountless events remain valid for webhook endpoints
configured directly on the connected account.

Financial Account creation, closure, and feature-status changes normalize to account events.
Transaction events remain transaction events, while Outbound Payment and Outbound Transfer events
normalize to generic transfer events. Unknown verified event types remain available with
`normalizedType: null`; they never enter payment webhook reconciliation.

---

[Stripe Provider](18-stripe.md) · [Treasury Providers](17a-treasury-providers.md) · [Index](../00-index.md)
