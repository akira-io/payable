export interface PayableErrorOptions {
  code?: string;
  context?: Record<string, unknown>;
  correlationId?: string;
  cause?: unknown;
}

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
  }

  static notImplemented(symbol: string): PayableError {
    return new PayableError(`Not implemented: ${symbol}`, { code: 'NOT_IMPLEMENTED' });
  }
}
