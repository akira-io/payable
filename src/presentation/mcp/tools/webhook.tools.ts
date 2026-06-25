import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { authorizationFrom, providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { providerShape, tenantShape } from '../schemas';

export function registerWebhookTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('webhook_replay', 'mutate')) {
    server.registerTool(
      'webhook_replay',
      {
        description: 'Replay a stored webhook event by id.',
        inputSchema: { id: z.string().min(1), ...providerShape, ...tenantShape },
      },
      (args) =>
        respond(async () => {
          const tenantId = tenantFrom(args, options);
          await payable.replayWebhook(
            args.id,
            { ...authorizationFrom('webhook_replay', args, options), tenantId: tenantId ?? null },
            providerFrom(args, options),
          );
          return { replayed: args.id };
        }),
    );
  }
}
