import type { LogContext, Logger } from '../../domain/contracts/logger.contract';
import { isSensitiveKey } from '../redact';

const REDACTED = '[redacted]';

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested);
    }
    return result;
  }
  return value;
}

export function redactContext(context: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(value);
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
