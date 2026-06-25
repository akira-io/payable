import { isSensitiveKey } from './redact';

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
