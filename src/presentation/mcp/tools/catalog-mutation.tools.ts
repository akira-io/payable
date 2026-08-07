import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { providerFrom, resolveCatalogAccess, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import {
  idempotencyKeyShape,
  moneyObject,
  providerShape,
  recurringInterval,
  tenantShape,
  toMoney,
} from '../schemas';

const metadata = z.record(z.string(), z.string()).optional();

export function registerCatalogTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('product_create', 'mutate')) {
    server.registerTool(
      'product_create',
      {
        description: 'Create a product with the configured provider.',
        inputSchema: {
          name: z.string().min(1),
          description: z.string().optional(),
          active: z.boolean().optional(),
          metadata,
          ...idempotencyKeyShape,
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = resolveCatalogAccess('product_create', args, options);
          return payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .products.create(
              {
                name: args.name,
                description: args.description,
                active: args.active,
                metadata: args.metadata,
              },
              { authorization, idempotencyKey: args.idempotencyKey },
            );
        }),
    );
  }

  if (gate('product_update', 'mutate')) {
    server.registerTool(
      'product_update',
      {
        description: 'Update an existing provider product.',
        inputSchema: {
          providerProductId: z.string().min(1),
          name: z.string().optional(),
          description: z.string().optional(),
          active: z.boolean().optional(),
          ...idempotencyKeyShape,
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = resolveCatalogAccess('product_update', args, options);
          return payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .products.update(
              {
                providerProductId: args.providerProductId,
                name: args.name,
                description: args.description,
                active: args.active,
              },
              { authorization, idempotencyKey: args.idempotencyKey },
            );
        }),
    );
  }

  if (gate('price_create', 'mutate')) {
    server.registerTool(
      'price_create',
      {
        description: 'Create a price for a provider product.',
        inputSchema: {
          providerProductId: z.string().min(1),
          unitAmount: moneyObject,
          interval: recurringInterval.optional(),
          intervalCount: z.number().int().positive().optional(),
          description: z.string().optional(),
          ...idempotencyKeyShape,
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() => {
          const authorization = resolveCatalogAccess('price_create', args, options);
          return payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .prices.create(
              {
                providerProductId: args.providerProductId,
                unitAmount: toMoney(args.unitAmount),
                interval: args.interval,
                intervalCount: args.intervalCount,
                description: args.description,
              },
              { authorization, idempotencyKey: args.idempotencyKey },
            );
        }),
    );
  }
}
