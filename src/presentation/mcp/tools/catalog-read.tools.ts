import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Payable } from '../../../payable';
import { providerFrom, respond, tenantFrom } from '../context';
import type { McpPayableOptions } from '../options';
import type { ToolGate } from '../policy';
import { providerShape, tenantShape } from '../schemas';

const catalogLimit = z.number().int().min(1).max(100).optional();
const catalogListShape = {
  limit: catalogLimit,
  cursor: z.string().min(1).optional(),
  active: z.boolean().optional(),
};

export function registerCatalogReadTools(
  server: McpServer,
  payable: Payable,
  options: McpPayableOptions,
  gate: ToolGate,
): void {
  if (gate('product_get', 'read')) {
    server.registerTool(
      'product_get',
      {
        description: 'Fetch a provider product by id.',
        inputSchema: { id: z.string().min(1), ...providerShape, ...tenantShape },
      },
      (args) =>
        respond(() =>
          payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .products.retrieve(args.id),
        ),
    );
  }

  if (gate('products_list', 'read')) {
    server.registerTool(
      'products_list',
      {
        description: 'List provider products.',
        inputSchema: { ...catalogListShape, ...providerShape, ...tenantShape },
      },
      (args) =>
        respond(() =>
          payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .products.list({
              limit: args.limit,
              cursor: args.cursor,
              active: args.active,
            }),
        ),
    );
  }

  if (gate('price_get', 'read')) {
    server.registerTool(
      'price_get',
      {
        description: 'Fetch a provider price by id.',
        inputSchema: { id: z.string().min(1), ...providerShape, ...tenantShape },
      },
      (args) =>
        respond(() =>
          payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .prices.retrieve(args.id),
        ),
    );
  }

  if (gate('prices_list', 'read')) {
    server.registerTool(
      'prices_list',
      {
        description: 'List provider prices, optionally filtered by product.',
        inputSchema: {
          ...catalogListShape,
          providerProductId: z.string().min(1).optional(),
          ...providerShape,
          ...tenantShape,
        },
      },
      (args) =>
        respond(() =>
          payable
            .providerCatalog(providerFrom(args, options), tenantFrom(args, options))
            .prices.list({
              limit: args.limit,
              cursor: args.cursor,
              active: args.active,
              providerProductId: args.providerProductId,
            }),
        ),
    );
  }
}
