# Invoices and Billing Portal

This page covers reading a customer's invoices, downloading an invoice PDF, and opening the
provider-hosted billing portal. All three depend on optional provider capabilities and degrade or
fail explicitly when the provider does not support them.

## Listing invoices

`ListInvoicesAction` (`src/application/actions/invoices/list-invoices.action.ts`) returns the
customer's invoices from the provider.

```ts
const invoices = await new ListInvoicesAction(deps).handle(billable, 50);
```

`handle(billable, limit?)`:

1. Requires the provider to be **invoice capable** (`isInvoiceCapable`, i.e. it implements both
   `listInvoices` and `downloadInvoicePdf`); otherwise throws `ProviderCapabilityNotSupportedError`
   (reported as the `invoicePdf` capability).
2. If there is no storage driver, returns `[]`.
3. Loads the local customer row; if it is missing or has no `providerCustomerId`, returns `[]`.
4. Calls `provider.listInvoices({ providerCustomerId, limit })`.

Output: `InvoiceDTO[]` (`src/domain/dtos/invoice.dto.ts`):

```ts
export interface InvoiceDTO {
  providerInvoiceId: string;
  status: InvoiceStatus;
  total: Money;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}
```

`total` is a `Money` value object; `hostedInvoiceUrl` and `invoicePdf` are provider-hosted links when
available.

## Downloading an invoice PDF

`DownloadInvoicePdfAction` (`src/application/actions/invoices/download-invoice-pdf.action.ts`) fetches
the raw PDF bytes for one invoice.

```ts
const pdf = await new DownloadInvoicePdfAction(deps).handle('in_1');
// pdf.filename -> 'in_1.pdf', pdf.content -> Uint8Array
```

`handle(providerInvoiceId)`:

1. Requires the provider to be invoice capable; otherwise throws `ProviderCapabilityNotSupportedError`.
2. Calls `provider.downloadInvoicePdf(providerInvoiceId)`.

Output: `InvoicePdfDTO`:

```ts
export interface InvoicePdfDTO {
  filename: string;
  content: Uint8Array;
}
```

The action takes the **provider** invoice id directly and does not touch storage. The application is
responsible for confirming the invoice belongs to the right customer before serving the bytes.

## Billing portal

`payable.customer(billable).billingPortal(returnUrl)`
(`src/application/builders/customer-context.ts`) returns a provider-hosted portal URL where the
customer can manage payment methods, invoices, and subscriptions.

```ts
const { url } = await payable
  .customer(billable)
  .billingPortal('https://app.test/account');

return redirect(url);
```

`billingPortal(returnUrl)`:

1. Asserts the provider's `billingPortal` capability via `assertProviderCapability`.
2. Syncs the customer to the provider (`SyncCustomerWithProviderAction`) to obtain the
   `providerCustomerId`.
3. Builds an idempotency key `portal:${providerName}:${billableType}:${billableId}`.
4. Calls `provider.billingPortal({ providerCustomerId, returnUrl }, ctx)`.

Output: `BillingPortalDTO` (`src/domain/dtos/billing-portal.dto.ts`):

```ts
export interface BillingPortalDTO {
  url: string;
}
```

```mermaid
sequenceDiagram
    participant App
    participant Ctx as CustomerContext
    participant Sync as SyncCustomerWithProviderAction
    participant Provider
    App->>Ctx: billingPortal(returnUrl)
    Ctx->>Ctx: assert billingPortal capability
    Ctx->>Sync: handle(billable)
    Sync-->>Ctx: providerCustomerId
    Ctx->>Provider: billingPortal({ providerCustomerId, returnUrl }, ctx)
    Provider-->>App: BillingPortalDTO { url }
```

## Provider dependency and capabilities

These features ride on optional provider methods declared as capability interfaces in
`src/domain/contracts/payment-provider.contract.ts`:

- **Invoices.** `InvoiceCapable` (`listInvoices`, `downloadInvoicePdf`). Detected with
  `isInvoiceCapable`. The capability surfaced in errors is `invoicePdf`
  (`src/domain/dtos/capabilities.dto.ts`).
- **Billing portal.** `billingPortal` is a required method on the `PaymentProvider` contract, but its
  availability is gated by the `billingPortal` capability flag, asserted before use.

The `ProviderCapabilities` flags (`checkout`, `subscriptions`, `trials`, `refunds`, `coupons`,
`billingPortal`, `meteredBilling`, `invoicePdf`) let the application probe support before calling -
see [17-providers.md](../integrations/17-providers.md).

## Inputs and outputs

| Operation | Input | Output |
| --- | --- | --- |
| List invoices | `Billable`, optional `limit` | `InvoiceDTO[]` |
| Download PDF | `providerInvoiceId` | `InvoicePdfDTO` (`{ filename, content }`) |
| Billing portal | `returnUrl` | `BillingPortalDTO` (`{ url }`) |

## Edge cases

- **Provider lacks invoice capability.** Both invoice actions throw
  `ProviderCapabilityNotSupportedError` (`invoicePdf`).
- **Provider lacks the billing-portal capability.** `billingPortal()` throws via
  `assertProviderCapability` before any sync or provider call.
- **No storage driver (invoices).** `ListInvoicesAction` returns `[]` instead of throwing.
- **No local customer / unmapped customer (invoices).** Returns `[]`.
- **Billing portal without storage.** The portal still syncs the customer via the provider, which
  requires no storage to obtain a `providerCustomerId`, but nothing is persisted - see
  [08-customers-billable.md](08-customers-billable.md).
- **PDF ownership.** `DownloadInvoicePdfAction` trusts the supplied provider invoice id; the caller
  must verify ownership.

---

[Previous: Charges and Refunds](11-charges-refunds.md) · [Index](../00-index.md) · [Next: Webhooks](13-webhooks.md)
