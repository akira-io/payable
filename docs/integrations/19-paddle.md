# Paddle Provider

`PaddleProvider` (`src/infrastructure/providers/paddle/paddle-provider.ts`) implements the base
`PaymentProvider` contract. Unlike Stripe, it implements **none** of the optional interfaces
(`ChargeCapable`, `DirectSubscriptionCapable`, `InvoiceCapable`). Its registry `name` is `'paddle'`.

## Construction and options

```ts
export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
  environment?: 'sandbox' | 'production';
  logger?: Logger;
}

new PaddleProvider(options: PaddleProviderOptions, client?: PaddleClient);
```

- `apiKey` - the Paddle API key used to lazily construct the SDK client.
- `webhookSecret` - passed to `PaddleWebhookVerifier`.
- `environment` (optional) - selects the Paddle `sandbox` or `production` environment when constructing
  the SDK client.
- `logger` (optional) - a `Logger` forwarded to `PaddleEventNormalizer`.
- `client` (optional) - an injected `PaddleClient` for tests. When omitted, the SDK is loaded on first
  use via `import('@paddle/paddle-node-sdk')` and `new Paddle(apiKey)`, keeping the dependency optional.

`PaddleClient` is a narrow structural interface declared in `paddle-types.ts` rather than the full SDK
type. The provider only depends on the methods it calls (`customers`, `products`, `prices`,
`transactions`, `subscriptions`, `adjustments`, `customerPortalSessions`, `webhooks`).

## Declared capabilities

```ts
capabilities(): ProviderCapabilities {
  return new Set(['checkout', 'subscriptions', 'refunds', 'billingPortal', 'customers', 'catalog']);
}
```

### Capability gaps versus Stripe

Paddle's set omits `trials`, `coupons`, `meteredBilling`, and `invoicePdf`. The differences are:

- **No `invoicePdf`** (Stripe declares it). Paddle does not implement `InvoiceCapable`, so there is no
  `listInvoices` / `downloadInvoicePdf`. `isInvoiceCapable(paddleProvider)` returns `false`.
- **No `ChargeCapable`.** Paddle has no `charge` method; one-off direct charges are not available.
  `isChargeCapable(paddleProvider)` returns `false`.
- **No `DirectSubscriptionCapable`.** Paddle has no `createSubscription` method. Subscriptions are
  created through the checkout/transaction flow, not a direct API call.
  `isDirectSubscriptionCapable(paddleProvider)` returns `false`.
- **Partial refunds are not supported.** `refund` throws when `input.amount` is set (see Failure
  scenarios). `meteredBilling` is absent, the same as Stripe.

## Mappers

`paddle-mappers.ts` converts Paddle entities (typed in `paddle-types.ts`) to domain DTOs:

- `toMinorUnits` parses Paddle's string amounts. Paddle returns money as a decimal **string** in minor
  units; the mapper validates it against `^-?\d+$` and throws `PayableError` (`PROVIDER_AMOUNT_INVALID`)
  for any non-integer value. It also rejects values outside the safe-integer range
  (`Number.isSafeInteger`) with the same `PROVIDER_AMOUNT_INVALID` code. `Money.of` then rebuilds the
  value object with an upper-cased currency.
- `toSubscriptionDTO` maps Paddle status through `SUBSCRIPTION_STATUS` (`active`, `trialing`,
  `past_due`, `paused`, `canceled`), defaulting unknown values to `incomplete`. `currentPeriodEnd` comes
  from `currentBillingPeriod.endsAt`. `trialEndsAt` is derived via `readTrialEndsAt`, which reads the
  subscription's `trialEndsAt` first, then falls back to the first item carrying a trial end
  (`trialDates.endsAt` / `trial_dates.ends_at`), returning `null` when none is present.
- `toProductDTO` derives `active` from `status === 'active'`.
- `toRefundResultDTO` maps a Paddle adjustment: `status` is `succeeded` when the adjustment is
  `approved`, otherwise `pending`. Amount falls back to `0` / `USD` when totals are absent.

## Event normalization

`PaddleEventNormalizer` (`paddle-event-normalizer.ts`) maps Paddle event types to `NormalizedEventName`:

| Paddle event type | Normalized name |
| --- | --- |
| `customer.created` | `customer.created` |
| `customer.updated` | `customer.updated` |
| `subscription.created` | `subscription.created` |
| `subscription.activated` | `subscription.created` |
| `subscription.updated` | `subscription.updated` |
| `subscription.canceled` | `subscription.cancelled` |
| `subscription.resumed` | `subscription.resumed` |
| `transaction.completed` | `payment.succeeded` |
| `transaction.paid` | `payment.succeeded` |
| `transaction.payment_failed` | `payment.failed` |
| `transaction.billed` | `invoice.created` |
| `adjustment.created` | `refund.created` |

Unmapped types normalize to `null`. Note `subscription.activated` and `subscription.created` both
collapse to `subscription.created`, and the two transaction-success events both map to
`payment.succeeded`.

## Webhook verification

`PaddleWebhookVerifier` (`paddle-webhook-verifier.ts`) delegates to the SDK's `webhooks.unmarshal`:

```ts
private async unmarshal(client, payload, signature) {
  try {
    return await client.webhooks.unmarshal(payload, this.secret, signature);
  } catch (error) {
    throw new InvalidWebhookSignatureError('paddle', { cause: error });
  }
}
```

`unmarshal` receives the raw body, the configured `webhookSecret`, and the Paddle signature header. It
returns a `PaddleWebhookEvent` (`eventId`, `eventType`, `data`) or `null`. The verifier treats a thrown
error **and** a `null` result as a signature failure, throwing `InvalidWebhookSignatureError` with
`provider: 'paddle'`. `verifyWebhook` then returns a `VerifiedWebhook` built from those fields.

## Failure scenarios and recovery

| Scenario | Symptom | Recovery |
| --- | --- | --- |
| Partial refund requested | `ProviderCapabilityNotSupportedError('paddle', 'partial refund')` thrown by `refund` when `input.amount` is set | Issue a full refund (omit `amount`). Paddle adjustments are created with `type: 'full'`. |
| Invalid webhook signature | `InvalidWebhookSignatureError` (`provider: 'paddle'`) on a thrown error or a `null` unmarshal result | Verify `webhookSecret` matches the Paddle notification setting and the raw body is forwarded unmodified. |
| Non-integer amount from Paddle | `PayableError` `PROVIDER_AMOUNT_INVALID` from `toMinorUnits` | Indicates an unexpected amount format; inspect the offending entity. |
| Paddle API error | The SDK error propagates from the called method | Calls are idempotent via `ctx.idempotencyKey`; safe to retry the same operation with the same key. |

Every Paddle provider method (e.g. `createCustomer`, `refund`) receives an `OperationContext` and
forwards `ctx.idempotencyKey` to the Paddle API: the private `paddle(ctx.idempotencyKey)` helper scopes
the SDK client through `withIdempotencyKey`, so retries with the same key are safe. Idempotency at the
engine boundary is additionally handled by the idempotency store.

## Configuration example

```ts
import { createPayable } from '@akira-io/payable';
import { PaddleProvider } from '@akira-io/payable';

const paddle = new PaddleProvider({
  apiKey: process.env.PADDLE_API_KEY!,
  webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
});

const payable = createPayable({
  providers: { paddle },
  // storage, queue, events, clock ...
});

// Full refund (partial throws ProviderCapabilityNotSupportedError):
await payable.refund({ paymentId: 'txn_123' });
```

---

[Previous: Stripe](18-stripe.md) · [Index](../00-index.md) · [Next: SISP](20-sisp.md)
