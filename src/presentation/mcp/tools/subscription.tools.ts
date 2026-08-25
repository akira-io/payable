import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import {
  runSubscriptionPriceMigrationAction,
  runSubscriptionPriceMigrationList,
  runSubscriptionPriceMigrationPreview,
  runSubscriptionPriceMigrationRetrieve,
  type SubscriptionPriceMigrationAction,
} from '../../shared/operations';
import {
  createSubscriptionPriceMigrationPreviewSchema,
  subscriptionPriceMigrationListInputShape,
} from '../../shared/schemas';
import { authorizeTool, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { requiredIdempotencyKeyShape, tenantShape } from '../schemas';

const PREFIX = 'canonical_subscription_price_migration';
const migrationIdSchema = z.object({ id: z.string().min(1), ...tenantShape }).strict();
const listSchema = z
  .object({ ...subscriptionPriceMigrationListInputShape, ...tenantShape })
  .strict();
const createSchema = createSubscriptionPriceMigrationPreviewSchema({
  ...requiredIdempotencyKeyShape,
  ...tenantShape,
});

export function registerSubscriptionPriceMigrationTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate(`${PREFIX}_create`, 'mutate')) {
    server.registerTool(
      `${PREFIX}_create`,
      {
        description: 'Create an immutable provider-neutral subscription price migration preview.',
        inputSchema: createSchema,
      },
      (args) =>
        respond(() => {
          const { idempotencyKey, tenantId: _tenantId, ...body } = args;
          return runSubscriptionPriceMigrationPreview(
            payable,
            body,
            tenantFrom(args, options) ?? null,
            authorizeTool(`${PREFIX}_create`, args, options),
            idempotencyKey,
          );
        }),
    );
  }

  if (gate(`${PREFIX}s_list`, 'read')) {
    server.registerTool(
      `${PREFIX}s_list`,
      {
        description: 'List a bounded page of canonical subscription price migrations.',
        inputSchema: listSchema,
      },
      (args) =>
        respond(() =>
          runSubscriptionPriceMigrationList(
            payable,
            args,
            tenantFrom(args, options) ?? null,
            authorizeTool(`${PREFIX}s_list`, args, options),
          ),
        ),
    );
  }

  if (gate(`${PREFIX}_get`, 'read')) {
    server.registerTool(
      `${PREFIX}_get`,
      {
        description: 'Retrieve a canonical subscription price migration.',
        inputSchema: migrationIdSchema,
      },
      (args) =>
        respond(() =>
          runSubscriptionPriceMigrationRetrieve(
            payable,
            args.id,
            tenantFrom(args, options) ?? null,
            authorizeTool(`${PREFIX}_get`, args, options),
          ),
        ),
    );
  }

  for (const action of ['approve', 'cancel', 'retry'] as const) {
    registerMutation(action);
  }

  function registerMutation(action: SubscriptionPriceMigrationAction): void {
    const toolName = `${PREFIX}_${action}`;
    if (!gate(toolName, 'mutate')) return;
    const actionSchema = migrationIdSchema.extend(requiredIdempotencyKeyShape).strict();
    server.registerTool(
      toolName,
      {
        description: `${action} a canonical subscription price migration.`,
        inputSchema: actionSchema,
      },
      (args) =>
        respond(() =>
          runSubscriptionPriceMigrationAction(
            payable,
            action,
            args.id,
            tenantFrom(args, options) ?? null,
            authorizeTool(toolName, args, options),
            args.idempotencyKey,
          ),
        ),
    );
  }
}
