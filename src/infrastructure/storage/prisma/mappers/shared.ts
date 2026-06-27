export function toMinor(value: bigint | number | string, column: string): number {
  const parsed = typeof value === 'bigint' ? value : BigInt(String(value));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `Money column ${column} (${parsed}) exceeds the safe integer range; values beyond 2^53-1 lose precision`,
    );
  }
  return Number(parsed);
}

export function fromMinor(value: number | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

export function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function toJsonString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : JSON.stringify(value);
}

export function tenant(tenantId: string | null | undefined): string {
  return tenantId ?? '';
}

export function stripUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
