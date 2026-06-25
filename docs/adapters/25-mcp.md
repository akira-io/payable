# MCP Adapter

`@akira-io/payable/mcp` exposes the Payable facade as a [Model Context
Protocol](https://modelcontextprotocol.io) server, so an AI client (Claude Desktop, Claude Code,
or any MCP host) can read and operate billing state through tools, resources, and prompts. It
follows the same factory pattern as the HTTP adapters: `createPayableMcpServer(payable, options)`.

## Purpose

Turn billing queries, resources, and builders into MCP tools. The adapter contains no business
logic: every tool is a thin call into the facade. A `payable-mcp` bin makes it runnable as a
standalone server over stdio or streamable HTTP.

## Factory

```ts
import { createPayableMcpServer } from '@akira-io/payable/mcp';

const server = createPayableMcpServer(payable, options);
```

```ts
interface McpPayableOptions {
  serverInfo?: { name?: string; version?: string };
  defaultProvider?: string;
  defaultTenantId?: string | null;
  policy?: McpPolicy;
}

interface McpPolicy {
  readOnly?: boolean; // default false
  allowMoneyMovement?: boolean; // default false
  enabledTools?: string[]; // default: every tool except money tools
  authorization?: (toolName: string, args: Record<string, unknown>) => AuthorizationContext;
}
```

`@modelcontextprotocol/sdk` is an optional peer dependency; install it to use this adapter.

## Tools

Every tool accepts an optional `tenantId` and `provider`. Money amounts are minor units, passed as
`{ amount, currency }` and converted to the `Money` value object.

| Tool | Kind | Backing call |
| --- | --- | --- |
| `providers_list` | read | `payable.providers().names()` |
| `customer_get` | read | `payable.customers().get(billable)` |
| `subscriptions_list` | read | per-billable or global `payable.subscriptions()` |
| `subscription_get` | read | `payable.customer().subscription(name).get()` |
| `payments_list` | read | per-billable or global `payable.payments()` |
| `invoices_list` | read | `payable.customer().invoices(limit)` |
| `invoice_pdf` | read | `payable.invoices().downloadPdf(id)` |
| `refunds_list` | read | `payable.refunds().list(paymentId)` |
| `audit_logs_query` | read | `payable.auditLogs(tenantId).run(filter)` |
| `webhooks_list` | read | `payable.webhookEvents(tenantId).list(filter)` |
| `webhook_get` | read | `payable.webhookEvents(tenantId).get(id)` |
| `product_create` / `product_update` | mutate | `payable.products()` |
| `price_create` | mutate | `payable.prices()` |
| `subscription_create` | mutate | subscription builder |
| `subscription_swap` | mutate | `subscription(name).swap(...)` |
| `subscription_cancel` / `_cancel_now` / `_resume` | mutate | subscription manager |
| `subscription_update_quantity` | mutate | `subscription(name).updateQuantity(...)` |
| `checkout_create` | mutate | subscription checkout builder |
| `billing_portal` | mutate | `payable.customer().billingPortal(returnUrl)` |
| `charge` | money | `payable.customer().charge(...)` |
| `refund` | money | `payable.refund(...)` |
| `webhook_replay` | mutate | `payable.replayWebhook(id, context, provider)` |

## Resources and prompts

- Resource `payable://schema/entities` returns entity field names and status enums.
- Resource `payable://config/providers` returns the configured provider names.
- Prompt `diagnose_subscription` guides an investigation of a subscription and its recent activity.

## Safety

- Money movement is OFF by default. `charge` and `refund` register only when
  `policy.allowMoneyMovement === true` and `policy.readOnly !== true`.
- `policy.readOnly` hides every mutating tool.
- `policy.enabledTools` restricts the surface to an explicit allow-list.
- Mutations pass an `AuthorizationContext` (from `policy.authorization`). The underlying actions run
  `assertAuthorized` and write an immutable audit log entry, so the adapter adds no bypass.
- When tenancy is enabled, every tool requires a `tenantId` (the facade throws `TENANT_REQUIRED`).

## Running the bin

The `payable-mcp` bin is the only place that reads a config file, preserving the core principle that
the library never reads the environment. The config module composes a `Payable` instance:

```ts
// payable.config.ts
import { createPayable } from '@akira-io/payable';

const payable = createPayable({ providers: { stripe: stripeProvider }, storage });

export default { payable, mcp: { policy: { allowMoneyMovement: false } } };
```

stdio (spawned by an MCP host):

```bash
payable-mcp --config ./payable.config.ts
```

Claude Desktop / Claude Code configuration:

```json
{
  "mcpServers": {
    "payable": {
      "command": "payable-mcp",
      "args": ["--config", "./payable.config.ts"]
    }
  }
}
```

Streamable HTTP:

```bash
payable-mcp --config ./payable.config.ts --http 127.0.0.1:3333
```

The HTTP transport is stateless (JSON responses). Set `PAYABLE_MCP_TOKEN` to require a
`Authorization: Bearer <token>` header. The transport applies no TLS, rate limiting, or OAuth;
terminate TLS and add network controls at your edge.

## Embedding the server

```ts
import { createPayableMcpServer, serveStdio, serveHttp } from '@akira-io/payable/mcp';

await serveStdio(createPayableMcpServer(payable, { policy: { readOnly: true } }));

await serveHttp(() => createPayableMcpServer(payable), { port: 3333 });
```

`serveHttp` takes a factory because each request gets its own server and transport.

---

[Previous: NestJS](24-nestjs.md) | [Index](../00-index.md) | [Next: Data Flows](../26-data-flows.md)
