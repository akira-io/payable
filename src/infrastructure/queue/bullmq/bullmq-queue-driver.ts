import type { QueueDriver } from '../../../domain/contracts/queue-driver.contract';
import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 7
export class BullMQQueueDriver implements QueueDriver {
  constructor(protected readonly options: unknown) {}

  dispatch(): Promise<void> {
    return this.unsupported('dispatch');
  }

  process(): void {
    this.unsupported('process');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`BullMQQueueDriver.${op} (Phase 7)`);
  }
}
