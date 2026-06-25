function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeIdentifier(value: string, label: string, maxLength = 256): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} cannot be empty`);
  }
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} exceeds ${maxLength} characters (got ${normalized.length})`);
  }
  if (hasControlCharacter(normalized)) {
    throw new TypeError(`${label} cannot contain control characters`);
  }
  return normalized;
}
