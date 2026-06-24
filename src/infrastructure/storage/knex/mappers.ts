export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function toMinor(value: unknown, column: string): number {
  const parsed = typeof value === 'bigint' ? value : BigInt(String(value));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `Money column ${column} (${parsed}) exceeds the safe integer range; values beyond 2^53-1 lose precision`,
    );
  }
  return Number(parsed);
}

export function toDate(value: unknown): Date {
  return new Date(value as string | number);
}

export function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as string | number);
}

export function fromDate(value: Date | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : value.toISOString();
}

export function toJson<T>(value: unknown): T | null {
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

export function fromJson(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : JSON.stringify(value);
}

export function stripUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
