import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 15
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic-module convention.
export class PayableModule {
  static forRoot(): unknown {
    throw PayableError.notImplemented('PayableModule.forRoot (Phase 15)');
  }
}
