export interface TenantResolutionContext {
  provider: string;
  headers: Record<string, string>;
  payload: string;
}

export interface TenantResolver {
  resolve(context: TenantResolutionContext): string | null | Promise<string | null>;
}
