import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Payable } from '../../../payable';
import type { McpPayableOptions } from '../options';
import { isToolEnabled, resolvePolicy, type ToolGate } from '../policy';
import { registerCanonicalPaymentTools } from './canonical-payment.tools';
import { registerCanonicalReadTools } from './canonical-read.tools';
import { registerCatalogLifecycleTools } from './catalog-lifecycle.tools';
import { registerCatalogTools } from './catalog-mutation.tools';
import { registerMoneyTools } from './money.tools';
import { registerCatalogReadTools, registerReadTools } from './read.tools';
import { registerWebhookTools } from './webhook.tools';
import { registerCustomerTools, registerLinkTools, registerSubscriptionTools } from './write.tools';

export function registerTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
): void {
  const policy = resolvePolicy(options.policy);
  const gate: ToolGate = (name, kind) => isToolEnabled(name, kind, policy);
  registerReadTools(server, payable, options, gate);
  registerCanonicalReadTools(server, payable, options, gate);
  registerCanonicalPaymentTools(server, payable, options, gate);
  registerCatalogReadTools(server, payable, options, gate);
  registerCatalogTools(server, payable, options, gate);
  registerCatalogLifecycleTools(server, payable, options, gate);
  registerCustomerTools(server, payable, options, gate);
  registerSubscriptionTools(server, payable, options, gate);
  registerLinkTools(server, payable, options, gate);
  registerMoneyTools(server, payable, options, gate);
  registerWebhookTools(server, payable, options, gate);
}
