# Revolut Payouts

`RevolutProvider` implements the read-only `PayoutCapable` contract with Merchant API payout list and
retrieve operations.

## Operations

- `listPayouts({ limit })` calls `GET /api/payouts`; the default limit is 100 and the provider caps
  it at Revolut's maximum of 500.
- `retrievePayout(providerPayoutId)` calls `GET /api/payouts/{payout_id}`.

Revolut states map to Payable payout statuses as follows:

| Revolut | Payable |
| --- | --- |
| `processing` | `pending` |
| `completed` | `paid` |
| `failed` | `failed` |

The DTO includes the provider id, status, amount, and creation time. Revolut does not return an
expected arrival date, so `arrivalAt` is `null`. Its schema does not require amount and currency on
every response; Payable returns `amount: null` unless both fields are present.

Creating payouts remains outside this capability because Stripe and Revolut use materially different
funding and destination models.

---

[Revolut Provider](21-revolut.md) · [Index](../00-index.md)
