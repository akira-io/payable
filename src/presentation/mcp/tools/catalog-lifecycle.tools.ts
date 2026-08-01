import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { authorizeTool, providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { providerShape, tenantShape } from '../schemas';

type CatalogAction = 'activate' | 'archive';
type CatalogResource = 'product' | 'price';

export function registerCatalogLifecycleTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  registerLifecycleTool(server, payable, options, gate, 'product', 'activate');
  registerLifecycleTool(server, payable, options, gate, 'product', 'archive');
  registerLifecycleTool(server, payable, options, gate, 'price', 'activate');
  registerLifecycleTool(server, payable, options, gate, 'price', 'archive');
}

function registerLifecycleTool(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
  resource: CatalogResource,
  action: CatalogAction,
): void {
  const toolName = `${resource}_${action}`;
  if (!gate(toolName, 'mutate')) {
    return;
  }
  server.registerTool(
    toolName,
    {
      description: `${action === 'activate' ? 'Activate' : 'Archive'} a provider ${resource}.`,
      inputSchema: { id: z.string().min(1), ...providerShape, ...tenantShape },
    },
    (args) =>
      respond(() => {
        authorizeTool(toolName, args, options);
        const provider = providerFrom(args, options);
        const tenant = tenantFrom(args, options);
        if (resource === 'product') {
          return payable.products(provider, tenant)[action](args.id);
        }
        return payable.prices(provider, tenant)[action](args.id);
      }),
  );
}
