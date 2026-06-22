import type { Encryption } from '../../domain/contracts/encryption.contract';
import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 11
export class NodeEncryptionDriver implements Encryption {
  constructor(protected readonly options: { key: string }) {}

  encrypt(): Promise<string> {
    return this.unsupported('encrypt');
  }

  decrypt(): Promise<string> {
    return this.unsupported('decrypt');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`NodeEncryptionDriver.${op} (Phase 11)`);
  }
}
