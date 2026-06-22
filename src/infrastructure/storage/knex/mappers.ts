export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
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
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
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
