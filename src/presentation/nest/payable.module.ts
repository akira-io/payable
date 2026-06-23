import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { Payable } from '../../payable';
import { type NestPayableOptions, PAYABLE_INSTANCE, PAYABLE_OPTIONS } from './payable.constants';
import { PayableController } from './payable.controller';
import { PayableExceptionFilter } from './payable.exception-filter';
import { PayableAuthGuard } from './payable-auth.guard';

@Module({})
export class PayableModule {
  static forRoot(payable: Payable, options: NestPayableOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: PAYABLE_INSTANCE, useValue: payable },
      { provide: PAYABLE_OPTIONS, useValue: options },
      PayableExceptionFilter,
      PayableAuthGuard,
    ];
    if (options.authenticate) {
      providers.push(options.authenticate);
    }
    return {
      module: PayableModule,
      controllers: [PayableController],
      providers,
    };
  }
}
