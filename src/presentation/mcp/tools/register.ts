import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Payable } from '../../../payable';
import type { McpPayableOptions } from '../options';
import { isToolEnabled, resolvePolicy, type ToolGate } from '../policy';
import { registerMoneyTools } from './money.tools';
import { registerReadTools } from './read.tools';
import { registerWebhookTools } from './webhook.tools';
import { registerCatalogTools, registerLinkTools, registerSubscriptionTools } from './write.tools';

export function registerTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
): void {
  const policy = resolvePolicy(options.policy);
  const gate: ToolGate = (name, kind) => isToolEnabled(name, kind, policy);
  registerReadTools(server, payable, options, gate);
  registerCatalogTools(server, payable, options, gate);
  registerSubscriptionTools(server, payable, options, gate);
  registerLinkTools(server, payable, options, gate);
  registerMoneyTools(server, payable, options, gate);
  registerWebhookTools(server, payable, options, gate);
}
