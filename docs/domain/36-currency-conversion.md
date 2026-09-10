# Currency conversion

`Money` only does arithmetic within one currency. Converting a price between currencies goes
through `CurrencyConverter`, which is central to the package and shared by every provider, so no
provider decides on its own what an amount means.

## Why it exists

A gateway that settles in a single currency — SISP charges in escudos and sends `132` as its
numeric currency code — receives whatever minor units it is handed and labels them with its own
currency. An unconverted `EUR 25.00` becomes `25 CVE` on the payment form, about one hundredth of
the price.

## Rates

An `ExchangeRate` carries the pair and the exact decimal text of the rate, plus the `bigint`
fraction derived from it. Rates are never held as `number`: `110.265` has no exact binary
representation and the error grows with the amount.

```ts
import { ExchangeRate } from '@akira-io/payable';

const rate = ExchangeRate.of('EUR', 'CVE', '110.265');
rate.toJSON(); // { from: 'EUR', to: 'CVE', rate: '110.265' }
```

Rates come from an `ExchangeRateProvider`. The one shipped today reads a configured parity table,
which is legitimate for currencies pegged to each other and not for floating pairs. Pairs are
explicit: configuring `EUR/CVE` does not create `CVE/EUR`, because an inverted rounded rate does
not return the original amount.

```ts
import { CurrencyConverter, FixedExchangeRateProvider } from '@akira-io/payable';

const converter = new CurrencyConverter(
  new FixedExchangeRateProvider({ 'EUR/CVE': '110.265' }),
);
```

## Converting

```ts
const conversion = await converter.convert(Money.of(2500, 'EUR'), 'CVE');

conversion.source.amount(); // 2500
conversion.converted.amount(); // 275663
conversion.rate.rate; // '110.265'
```

The result carries the source amount, the converted amount, the pair and the applied rate. Store
all of them: a conversion that leaves no trace cannot be reconciled later.

Converting to the same currency is a transparent pass-through — the same `Money` instance, an
identity rate, no rounding and no loss. A pair with no configured rate throws
`ExchangeRateNotFoundError`; the converter never returns the unconverted amount.

## Rounding

The rate is applied in `bigint` arithmetic against each side's own minor units per major unit
(`CurrencyManager.minorUnitsPerMajor`, not a fixed power of ten — `MGA` and `MRU` are base 5), so
the result is rounded exactly once, half up away from zero — the same rule `Money.divide` and
`Money.percentage` use. The final integer is validated against the safe integer range.

## Where to convert

Convert when the checkout is created, and store the canonical amount, the charged amount and the
rate together. Under a fixed parity the moment makes no difference; under a variable rate,
converting at checkout is what keeps the price the customer saw and the amount they were charged
the same number.

---

[Previous: Subscription Price Migrations](35-subscription-price-migrations.md) · [Index](../00-index.md)
