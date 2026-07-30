# MCP Server

Expose Payable's billing resources and guarded operations to an MCP client.

## Prerequisites

- `@akira-io/payable` and `@modelcontextprotocol/sdk`
- A configured Payable instance with storage for read operations
- An MCP host such as Claude Desktop, Claude Code, or another compatible client

## Configuration

Create `payable.config.ts` in the application:

```ts
import { createPayable, StripeProvider } from '@akira-io/payable';
import { storage } from './billing-storage';

const stripe = new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
});

const payable = createPayable({
  providers: { stripe },
  storage,
});

export default {
  payable,
  mcp: {
    policy: {
      allowMoneyMovement: false,
    },
  },
};
```

Disabling money movement lets clients inspect billing state without exposing charge, refund, or
checkout tools.

## Run the example

Start the stdio server from the project directory:

```sh
payable-mcp --config ./payable.config.ts
```

Register that command in the MCP host:

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

## Expected result

The host discovers Payable tools, resources, and prompts. Read operations return the local billing
state, while the configured policy excludes money-moving tools.

## Failure behavior

The server reports a dependency hint when the MCP SDK is missing. A config that does not export a
Payable instance fails during startup. For HTTP transport, require `PAYABLE_MCP_TOKEN`, terminate TLS
at the edge, and keep DNS-rebinding protection enabled. See [MCP Adapter](../adapters/26-mcp.md).

---

[Previous: Revolut Merchant](43-revolut-merchant-checkout.md) | [Index](../00-index.md)
