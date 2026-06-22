import type { Logger } from '../../domain/contracts/logger.contract';

export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
