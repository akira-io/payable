export function assertCatalogTenantId(
  tenantId: string | null | undefined,
): asserts tenantId is string | null {
  if (tenantId === undefined) {
    throw new TypeError('tenantId is required for catalog repository operations');
  }
}
