const MAX_CANONICALIZE_DEPTH = 100;

export function canonicalize(value: unknown, depth = 0): string {
  if (depth > MAX_CANONICALIZE_DEPTH) {
    throw new TypeError(
      `Cannot hash a structure nested deeper than ${MAX_CANONICALIZE_DEPTH} levels`,
    );
  }
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
    return `[${value.map((item) => canonicalize(item, depth + 1)).join(',')}]`;
  }
  const serializable = value as { toJSON?: () => unknown };
  if (typeof serializable.toJSON === 'function') {
    return canonicalize(serializable.toJSON(), depth + 1);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new TypeError(`Cannot hash a non-serializable ${value.constructor.name} value`);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v, depth + 1)}`).join(',')}}`;
}

export async function hashRequest(request: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(request));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
