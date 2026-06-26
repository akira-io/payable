import type { AuthorizationContext } from '../../application/policies/authorization-context';

export type ToolArgs = Record<string, unknown>;

export interface McpPolicy {
  readOnly?: boolean;
  allowMoneyMovement?: boolean;
  requireAuthorization?: boolean;
  enabledTools?: string[];
  authorization?: (toolName: string, args: ToolArgs) => AuthorizationContext;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
}

export interface McpPayableOptions {
  serverInfo?: McpServerInfo;
  defaultProvider?: string;
  defaultTenantId?: string | null;
  allowTenantOverride?: boolean;
  policy?: McpPolicy;
}
