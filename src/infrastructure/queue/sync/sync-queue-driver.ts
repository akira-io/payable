import type { QueueDriver } from '../../../domain/contracts/queue-driver.contract';
import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 7
export class SyncQueueDriver implements QueueDriver {
  dispatch(): Promise<void> {
    return this.unsupported('dispatch');
  }

  process(): void {
    this.unsupported('process');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`SyncQueueDriver.${op} (Phase 7)`);
  }
}
