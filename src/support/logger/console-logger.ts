import type { LogContext, Logger } from '../../domain/contracts/logger.contract';

const SENSITIVE_KEY = /(authorization|password|secret|token|cookie|api[-_]?key|signature)/i;
const REDACTED = '[redacted]';

export function redactContext(context: LogContext): LogContext {
  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : value;
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
