export interface PayableErrorOptions {
  code?: string;
  context?: Record<string, unknown>;
  correlationId?: string;
  cause?: unknown;
}

const SENSITIVE_CONTEXT_KEY =
  /(authorization|password|secret|token|signature|api[-_]?key|cookie|card|cvv|cvc|pin)/i;

export class PayableError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(message: string, options: PayableErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? 'PAYABLE_ERROR';
    this.context = options.context;
    this.correlationId = options.correlationId;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, new.target);
  }

  static notImplemented(symbol: string): PayableError {
    return new PayableError(`Not implemented: ${symbol}`, { code: 'NOT_IMPLEMENTED' });
  }

  toJSON(): {
    name: string;
    code: string;
    message: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      context: this.context ? redactContext(this.context) : undefined,
    };
  }
}

function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = SENSITIVE_CONTEXT_KEY.test(key) ? '[redacted]' : value;
  }
  return result;
}
