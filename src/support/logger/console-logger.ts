import type { LogContext, Logger } from '../../domain/contracts/logger.contract';
import { isSensitiveKey } from '../redact';

const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);
    return value.map((entry) => redactValue(entry, seen));
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested, seen);
    }
    return result;
  }
  return value;
}

export function redactContext(context: LogContext): LogContext {
  const seen = new WeakSet<object>();
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, seen);
  }
  return result;
}

export class ConsoleLogger implements Logger {
  debug(message: string, context?: LogContext): void {
    console.debug(message, context ? redactContext(context) : {});
  }

  info(message: string, context?: LogContext): void {
    console.info(message, context ? redactContext(context) : {});
  }

  warn(message: string, context?: LogContext): void {
    console.warn(message, context ? redactContext(context) : {});
  }

  error(message: string, context?: LogContext): void {
    console.error(message, context ? redactContext(context) : {});
  }
}
