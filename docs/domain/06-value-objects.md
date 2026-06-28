# Value Objects

Value objects live in `src/domain/value-objects/`. They wrap a primitive (or a backing library) behind a small, validated, immutable type. Each one uses a `private constructor` plus a static factory (`of`, `generate`, or domain-specific builders), so an instance can only exist in a valid state. None of them expose setters; operations return new instances or plain results.

## Money

`src/domain/value-objects/money.ts`. The most important value object in the domain.

### Purpose and the no-floats rule

`Money` represents an exact monetary amount in **minor units** (cents for a 2-decimal currency, whole units for a 0-decimal currency like JPY). It never stores a float of major units. Construction enforces this:

```ts
Money.of(1099, 'USD'); // $10.99
Money.of(1000, 'JPY'); // ¥1,000

Money.of(10.99, 'USD'); // throws TypeError: amount must be an integer in minor units
```

```ts
expect(Money.of(1099, 'USD').amount()).toBe(1099);
expect(Money.of(1000, 'JPY').amount()).toBe(1000);
expect(() => Money.of(10.99, 'USD')).toThrow(TypeError);
```

The amount must be an integer (`Number.isInteger`); a non-integer throws `TypeError`. All arithmetic stays in integer minor units, so there is no floating-point drift.

### Construction and backing

- `Money.of(minorAmount: number, currency: CurrencyInput): Money` - the only constructor (the real constructor is private).
- The currency code is resolved through `CurrencyManager.resolve`, which normalizes it (see Currency below) and validates it against the dinero.js currency registry. The stored currency code is the canonical uppercase form:

```ts
expect(Money.of(1099, 'eur').currency()).toBe('EUR');
```

Internally `Money` wraps a `Dinero<number>` value (dinero.js) plus the normalized `CurrencyCode`. dinero.js performs the integer arithmetic; `Money` is the validated, domain-facing wrapper.

### Immutability

Every operation returns a **new** `Money`; the receiver is never mutated. The two internal fields (`value`, `code`) are `private readonly`.

### Accessors

- `amount(): number` - the minor-unit integer. Throws `RangeError` if the backing dinero scale no longer matches the currency exponent.
- `currency(): CurrencyCode` - the normalized currency code.
- `toJSON(): { amount, currency }` - serializes to the stored shape:

```ts
expect(Money.of(1099, 'EUR').toJSON()).toEqual({ amount: 1099, currency: 'EUR' });
```

### Arithmetic

| Method | Behavior | Constraints |
| --- | --- | --- |
| `add(other)` | Sum, same currency. | Throws `TypeError` (`Currency mismatch`) if currencies differ. |
| `subtract(other)` | Difference, same currency. | Same currency required. |
| `multiply(factor)` | Scale by an integer. | `factor` must be an integer, else `TypeError`. |
| `divide(divisor)` | Integer division with **half-up rounding**, no floats. | `divisor` must be an integer; `0` throws `RangeError`. |
| `percentage(basisPoints)` | Scale by basis points (`amount * bp / 10000`) computed in `bigint` with half-up rounding. | `basisPoints` must be an integer, else `TypeError`. |

```ts
expect(Money.of(1099, 'EUR').add(Money.of(100, 'EUR')).amount()).toBe(1199);
expect(Money.of(1099, 'EUR').subtract(Money.of(99, 'EUR')).amount()).toBe(1000);
expect(Money.of(1099, 'EUR').multiply(3).amount()).toBe(3297);

// division: half-up rounding, sign-aware, no floating point
expect(Money.of(1000, 'USD').divide(3).amount()).toBe(333);
expect(Money.of(1001, 'USD').divide(2).amount()).toBe(501);
expect(Money.of(-1001, 'USD').divide(2).amount()).toBe(-501);

expect(() => Money.of(100, 'USD').add(Money.of(100, 'EUR'))).toThrow('Currency mismatch');
expect(() => Money.of(100, 'USD').divide(0)).toThrow(RangeError);
```

`divide` rounds the remainder with the rule `remainder * 2 >= d ? quotient + 1 : quotient`, applied to the absolute value and then re-signed, so `-1001 / 2` rounds to `-501` (away from zero on the .5 boundary).

Every arithmetic op calls `assertSafeMinor` on its result and throws `RangeError` (`exceeds the safe integer range...`) when the minor-unit value would pass `Number.MAX_SAFE_INTEGER` - this is the **bigint overflow guard**. `percentage` does the scaling in `bigint` and only re-checks the safe-integer bound when converting the result back to a `number`.

### allocate

`allocate(ratios: number[]): Money[]` splits an amount across weighted shares **without losing a single minor unit**. It floors each share, then distributes the leftover remainder one unit at a time across the shares so the parts always sum back to the original.

```ts
// equal three-way split of 100 cents
const shares = Money.of(100, 'USD').allocate([1, 1, 1]);
expect(shares.map((s) => s.amount())).toEqual([34, 33, 33]);
expect(shares.reduce((sum, s) => sum + s.amount(), 0)).toBe(100);

// weighted split 1:3 of 1000 cents
expect(Money.of(1000, 'USD').allocate([1, 3]).map((s) => s.amount())).toEqual([250, 750]);
```

Edge cases (all throw `RangeError`):

```ts
Money.of(100, 'USD').allocate([]);      // requires at least one ratio
Money.of(100, 'USD').allocate([0, 0]);  // ratios must sum to a positive value
Money.of(100, 'USD').allocate([1, -1]); // ratios cannot be negative
```

### Comparison and predicates

| Method | Returns | Notes |
| --- | --- | --- |
| `equals(other)` | `boolean` | Same currency code **and** equal value. Does not throw on mismatch - returns `false`. |
| `isGreaterThan(other)` | `boolean` | Same currency required, else `TypeError`. |
| `isLessThan(other)` | `boolean` | Same currency required, else `TypeError`. |
| `isZero()` | `boolean` | `amount() === 0`. |
| `isNegative()` | `boolean` | `amount() < 0`. |

```ts
const a = Money.of(200, 'USD');
const b = Money.of(100, 'USD');
expect(a.isGreaterThan(b)).toBe(true);
expect(b.isLessThan(a)).toBe(true);
expect(a.equals(Money.of(200, 'USD'))).toBe(true);
expect(a.equals(b)).toBe(false);
expect(Money.of(0, 'USD').isZero()).toBe(true);
expect(Money.of(-1, 'USD').isNegative()).toBe(true);
```

`equals` compares the currency code directly (so it is safe across currencies and returns `false`), whereas the ordering predicates assert the same currency first and throw `TypeError` on a mismatch.

### format

`format(locale = 'en-US'): string` renders the amount with the currency symbol and the currency's own precision, using `Intl.NumberFormat`:

```ts
expect(Money.of(1099, 'USD').format()).toBe('$10.99');
expect(Money.of(1000, 'JPY').format()).toBe('¥1,000');
```

JPY has 0 decimal places, so `1000` minor units format as `¥1,000`; USD has 2, so `1099` formats as `$10.99`.

## Currency

`src/domain/value-objects/currency.ts`. Not a class - a small stateless helper module (`CurrencyManager`) plus the `CurrencyCode` and `DineroCurrency` types.

- `CurrencyCode = string` - an ISO-style currency code.
- `DineroCurrency` - `{ code, base, exponent }`, the shape exposed by `dinero.js/currencies`.

`CurrencyManager` reads from the dinero.js currency registry (case-insensitively, by uppercasing the input):

| Function | Behavior |
| --- | --- |
| `supports(code)` | `true` if the code is a known currency. |
| `resolve(code)` | Returns the `DineroCurrency`, or throws `RangeError` (`Unsupported currency code: <code>`) for an unknown code. |
| `precision(code)` | The currency's decimal exponent (number of minor-unit digits). |
| `isDecimalBase(code)` | `true` when the currency's `base` is `10`; used by `Money.format` to pick decimal vs non-decimal rendering. |
| `normalize(code)` | The canonical (uppercase) code. |

```ts
expect(CurrencyManager.precision('USD')).toBe(2);
expect(CurrencyManager.precision('JPY')).toBe(0);

expect(CurrencyManager.supports('usd')).toBe(true);
expect(CurrencyManager.supports('ZZZ')).toBe(false);

expect(CurrencyManager.normalize('eur')).toBe('EUR');
expect(() => CurrencyManager.resolve('ZZZ')).toThrow(RangeError);
```

`Money.of` calls `CurrencyManager.resolve` for both validation (unknown codes are rejected) and normalization (lowercase input becomes the canonical code).

## IdempotencyKey

`src/domain/value-objects/idempotency-key.ts`. A validated, deterministic string key for safely retrying operations.

- `IdempotencyKey.of(value)` - trims the input; throws `TypeError` on an empty/blank value or when the result exceeds `MAX_KEY_LENGTH` (512 characters).
- `toString()` and `equals(other)` for use and comparison.

Domain builders produce **deterministic, collision-resistant** keys from typed parts. Each part is URL-encoded (`encodeURIComponent`) before being joined with `:`, so a value containing the separator cannot forge a different key. Every builder injects a leading tenant segment (the URL-encoded `tenantId`, or an empty segment when none is given). Amount segments must be safe integers - a non-`Number.isSafeInteger` amount throws `TypeError`.

| Builder | Parts | Prefix |
| --- | --- | --- |
| `forCheckout` | `CheckoutKeyParts` | `checkout:` |
| `forCharge` | `ChargeKeyParts` | `charge:` |
| `forSubscription` | `SubscriptionKeyParts` | `subscription:` |
| `forRefund` | `RefundKeyParts` | `refund:` |
| `forSubscriptionOperation` | `SubscriptionOperationKeyParts` | `subscription:<operation>:` |
| `forWebhook` | `WebhookKeyParts` | `webhook:` |
| `forCustomer` | `BillableKeyParts` | `customer:` |
| `forBillingPortal` | `BillableKeyParts` | `portal:` |

```ts
IdempotencyKey.forCharge({
  provider: 'stripe', billableType: 'User', billableId: '1',
  reference: 'invoice_123', amount: 9900, currency: 'USD',
}).toString();
// => 'charge::stripe:User:1:invoice_123:9900:USD' (empty tenant segment after 'charge:')

IdempotencyKey.forWebhook({ provider: 'stripe', providerEventId: 'evt_1' }).toString();
// => 'webhook:stripe:evt_1'

expect(() => IdempotencyKey.of('  ')).toThrow(TypeError);
```

The encoding prevents separator collisions - a reference of `a:100` and an amount of `100` do not produce the same key as a reference of `a` and amount `100`:

```ts
const a = IdempotencyKey.forCharge({ ...base, reference: 'a:100', amount: 5 }).toString();
const b = IdempotencyKey.forCharge({ ...base, reference: 'a', amount: 100 }).toString();
expect(a).not.toBe(b);
expect(a).toContain('a%3A100'); // the ':' is encoded
```

## CorrelationId

`src/domain/value-objects/correlation-id.ts`. A trace identifier carried through requests, webhook events, and audit logs.

- `CorrelationId.of(value)` - trims; throws `TypeError` if empty.
- `CorrelationId.generate()` - a fresh UUID via `globalThis.crypto.randomUUID()`.
- `toString()`, `equals(other)`.

```ts
expect(CorrelationId.generate().toString()).not.toBe(CorrelationId.generate().toString());
expect(CorrelationId.of('corr_1').toString()).toBe('corr_1');
```

## TenantId

`src/domain/value-objects/tenant-id.ts`. A non-empty tenant identifier for multi-tenant scoping.

- `TenantId.of(value)` - trims; throws `TypeError` if empty.
- `toString()`, `equals(other)`.

```ts
expect(() => TenantId.of('')).toThrow(TypeError);
```

## ProviderName

`src/domain/value-objects/provider-name.ts`. A normalized billing-provider identifier.

- `ProviderName.of(name)` - trims and lowercases, then validates against `/^[a-z][a-z0-9_-]*$/` (must start with a letter; may contain lowercase letters, digits, `_`, `-`). Invalid input throws `TypeError`.
- `toString()`, `equals(other)`.

```ts
expect(ProviderName.of('Stripe').toString()).toBe('stripe');
expect(() => ProviderName.of('1bad')).toThrow(TypeError); // cannot start with a digit
```

## Email

`src/domain/value-objects/email.ts`. A validated, normalized email address backed by a Zod schema.

- `Email.of(value)` - trims and validates against `z.string().trim().email()`; throws `TypeError` (`Invalid email address: ...`) on an invalid value. The stored value is **lowercased**.
- `toString()`, `equals(other)`.

```ts
expect(Email.of('  USER@Example.com ').toString()).toBe('user@example.com');
expect(() => Email.of('not-an-email')).toThrow(TypeError);
```

## normalizeIdentifier

`src/domain/value-objects/identifier.ts`. Not a class - a single exported function used to clean and bound free-form identifier strings before they are stored or compared.

`normalizeIdentifier(value: string, label: string, maxLength = 256): string` trims the input and returns the trimmed string, throwing `TypeError` when:

| Condition | Message |
| --- | --- |
| Trimmed value is empty | `` `${label} cannot be empty` `` |
| Trimmed length exceeds `maxLength` | `` `${label} exceeds ${maxLength} characters (got ${length})` `` |
| Contains a control character | `` `${label} cannot contain control characters` `` |

The control-character check rejects C0/C1 ranges, `DEL`, zero-width and bidirectional formatting characters (`U+200B`-`U+200F`, `U+202A`-`U+202E`), line/paragraph separators (`U+2028`/`U+2029`), and the BOM (`U+FEFF`).

```ts
expect(normalizeIdentifier('  acct_1  ', 'Account id')).toBe('acct_1');
expect(() => normalizeIdentifier('', 'Account id')).toThrow(TypeError);
expect(() => normalizeIdentifier('a​b', 'Account id')).toThrow(TypeError);
```

## WebhookEndpointUrl

`src/domain/value-objects/webhook-endpoint-url.ts`. A validated outbound webhook destination URL.

- `WebhookEndpointUrl.parse(input)` - parses with `new URL(input)` and enforces three rules, throwing `PayableError` on each:

| Failure | code |
| --- | --- |
| Input is not a parseable URL | `WEBHOOK_ENDPOINT_INVALID_URL` |
| Protocol is not `https:` | `WEBHOOK_ENDPOINT_INVALID_URL` |
| Hostname resolves to a non-routable host (`isBlockedHostname`) | `WEBHOOK_ENDPOINT_BLOCKED_HOST` |

The stored `value` is the canonical `URL.toString()`. The non-routable-host check is the SSRF guard for outbound delivery targets.

```ts
expect(WebhookEndpointUrl.parse('https://example.com/hook').toString()).toBe(
  'https://example.com/hook',
);
expect(() => WebhookEndpointUrl.parse('http://example.com/hook')).toThrow(PayableError); // https only
expect(() => WebhookEndpointUrl.parse('https://127.0.0.1/hook')).toThrow(PayableError); // non-routable host
```

## WebhookSigningSecret

`src/domain/value-objects/webhook-signing-secret.ts`. A signing secret for outbound webhook deliveries, with a fixed `whsec_` prefix.

- `WebhookSigningSecret.generate()` - draws 32 random bytes via `globalThis.crypto.getRandomValues`, hex-encodes them, and prefixes `whsec_`.
- `WebhookSigningSecret.from(value)` - rebuilds from a stored string; throws `TypeError` unless the value starts with `whsec_` and is longer than the prefix.
- `toString()` returns the secret.
- `equals(other)` - **timing-safe** comparison via `timingSafeEqual`, so secret comparison does not leak length/content through timing.

```ts
const secret = WebhookSigningSecret.generate();
expect(secret.toString().startsWith('whsec_')).toBe(true);
expect(() => WebhookSigningSecret.from('nope')).toThrow(TypeError);
expect(WebhookSigningSecret.from(secret.toString()).equals(secret)).toBe(true);
```

## Status value objects

Each status is a string-literal union backed by a `const` array, with a runtime type guard and one or more domain predicates. These are the allowed values used by the corresponding entities and state machines.

### Invoice status

`src/domain/value-objects/invoice-status.ts`. `INVOICE_STATUSES`:

`draft` · `open` · `paid` · `uncollectible` · `void`

- `isInvoiceStatus(value): value is InvoiceStatus` - runtime guard.
- `isPaidInvoice(status)` - `status === 'paid'`.

### Payment status

`src/domain/value-objects/payment-status.ts`. `PAYMENT_STATUSES`:

`pending` · `processing` · `succeeded` · `failed` · `canceled` · `refunded` · `partially_refunded`

- `isPaymentStatus(value): value is PaymentStatus` - runtime guard.
- `isSuccessfulPayment(status)` - `status === 'succeeded'`.

### Refund status

`src/domain/value-objects/refund-status.ts`. `REFUND_STATUSES`:

`pending` · `succeeded` · `failed` · `canceled`

- `isRefundStatus(value): value is RefundStatus` - runtime guard.
- `isSuccessfulRefund(status)` - `status === 'succeeded'`.

### Subscription status

`src/domain/value-objects/subscription-status.ts`. `SUBSCRIPTION_STATUSES`:

`incomplete` · `incomplete_expired` · `trialing` · `active` · `past_due` · `canceled` · `unpaid` · `paused`

- `isSubscriptionStatus(value): value is SubscriptionStatus` - runtime guard.
- `isActiveSubscription(status)` - `status === 'active' || status === 'trialing'`.
- `isCanceledSubscription(status)` - `status === 'canceled'`.

The legal transitions between these status values are defined by the [state machines](07-state-machines.md).

---

[Previous: Domain Model](05-domain-model.md) · [Index](../00-index.md) · [Next: State Machines](07-state-machines.md)
