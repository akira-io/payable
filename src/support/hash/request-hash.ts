export function canonicalize(value: unknown): string {
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError(`Cannot hash a non-serializable ${typeof value} value`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`Cannot hash a non-finite number: ${value}`);
    }
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const serializable = value as { toJSON?: () => unknown };
  if (typeof serializable.toJSON === 'function') {
    return canonicalize(serializable.toJSON());
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export async function hashRequest(request: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(request));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
