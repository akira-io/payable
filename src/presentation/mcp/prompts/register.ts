import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'diagnose_subscription',
    {
      title: 'Diagnose a subscription',
      description: 'Guide an investigation of a billable subscription and its recent activity.',
      argsSchema: {
        billableType: z.string(),
        billableId: z.string(),
        email: z.string(),
        name: z.string(),
      },
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Diagnose subscription "${args.name}" for ${args.billableType}:${args.billableId} (${args.email}).`,
              'Steps:',
              '1. subscription_get for the subscription and report its status and period.',
              '2. payments_list for the billable and flag any failed or past_due payments.',
              '3. audit_logs_query filtered to the subscription to trace recent state changes.',
              '4. Summarize the likely cause and the next remediation step.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
