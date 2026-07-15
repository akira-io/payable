import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  type AuthorizationContext,
  isAuthorized,
} from '../../application/policies/authorization-context';
import { PayableError } from '../../domain/errors/payable-error';
import type { McpPayableOptions, ToolArgs } from './options';

export function providerFrom(args: ToolArgs, options: McpPayableOptions): string | undefined {
  return (args.provider as string | undefined) ?? options.defaultProvider;
}

export function tenantFrom(args: ToolArgs, options: McpPayableOptions): string | null | undefined {
  if (options.allowTenantOverride === true && args.tenantId !== undefined) {
    return args.tenantId as string | null;
  }
  return options.defaultTenantId;
}

export function authorizeTool(
  toolName: string,
  args: ToolArgs,
  options: McpPayableOptions,
): AuthorizationContext | undefined {
  const authorization = options.policy?.authorization;
  if (!authorization) {
    return undefined;
  }
  const context = authorization(toolName, args);
  if (!isAuthorized(context)) {
    throw new PayableError(`Not authorized to run ${toolName}`, {
      code: 'AUTHORIZATION_DENIED',
      context: { action: toolName },
    });
  }
  return context;
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: unknown): CallToolResult {
  const payload =
    error instanceof PayableError
      ? { error: error.code, message: error.message }
      : { error: 'INTERNAL_ERROR', message: 'Unexpected error' };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
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
