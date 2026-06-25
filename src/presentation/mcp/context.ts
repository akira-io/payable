import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AuthorizationContext } from '../../application/policies/authorization-context';
import { PayableError } from '../../domain/errors/payable-error';
import type { McpPayableOptions, ToolArgs } from './options';

export function providerFrom(args: ToolArgs, options: McpPayableOptions): string | undefined {
  return (args.provider as string | undefined) ?? options.defaultProvider;
}

export function tenantFrom(args: ToolArgs, options: McpPayableOptions): string | null | undefined {
  if (args.tenantId !== undefined) {
    return args.tenantId as string | null;
  }
  return options.defaultTenantId;
}

export function authorizationFrom(
  toolName: string,
  args: ToolArgs,
  options: McpPayableOptions,
): AuthorizationContext | undefined {
  return options.policy?.authorization?.(toolName, args);
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof PayableError ? error.code : 'INTERNAL_ERROR';
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

export async function respond(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}
