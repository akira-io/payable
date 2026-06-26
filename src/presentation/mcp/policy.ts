import type { McpPolicy } from './options';

export type ToolKind = 'read' | 'mutate' | 'money';

export type ToolGate = (name: string, kind: ToolKind) => boolean;

export interface ResolvedPolicy {
  readOnly: boolean;
  allowMoneyMovement: boolean;
  requireAuthorization: boolean;
  hasAuthorization: boolean;
  enabledTools?: Set<string>;
}

export function resolvePolicy(policy: McpPolicy = {}): ResolvedPolicy {
  return {
    readOnly: policy.readOnly ?? false,
    allowMoneyMovement: policy.allowMoneyMovement ?? false,
    requireAuthorization: policy.requireAuthorization ?? false,
    hasAuthorization: typeof policy.authorization === 'function',
    enabledTools: policy.enabledTools ? new Set(policy.enabledTools) : undefined,
  };
}

export function isToolEnabled(name: string, kind: ToolKind, policy: ResolvedPolicy): boolean {
  if (policy.enabledTools && !policy.enabledTools.has(name)) {
    return false;
  }
  if (policy.readOnly && kind !== 'read') {
    return false;
  }
  if (kind === 'money' && !policy.allowMoneyMovement) {
    return false;
  }
  if (kind !== 'read' && policy.requireAuthorization && !policy.hasAuthorization) {
    return false;
  }
  return true;
}
