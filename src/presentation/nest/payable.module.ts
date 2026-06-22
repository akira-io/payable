import { type DynamicModule, Module } from '@nestjs/common';
import type { Payable } from '../../payable';
import { type NestPayableOptions, PAYABLE_INSTANCE, PAYABLE_OPTIONS } from './payable.constants';
import { PayableController } from './payable.controller';
import { PayableExceptionFilter } from './payable.exception-filter';

@Module({})
export class PayableModule {
  static forRoot(payable: Payable, options: NestPayableOptions = {}): DynamicModule {
    return {
      module: PayableModule,
      controllers: [PayableController],
      providers: [
        { provide: PAYABLE_INSTANCE, useValue: payable },
        { provide: PAYABLE_OPTIONS, useValue: options },
        PayableExceptionFilter,
      ],
    };
  }
}
