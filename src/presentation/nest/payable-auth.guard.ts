import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { type NestPayableOptions, PAYABLE_OPTIONS } from './payable.constants';

@Injectable()
export class PayableAuthGuard implements CanActivate {
  constructor(
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.options.authenticate) {
      return true;
    }
    const guard = await this.moduleRef.create(this.options.authenticate);
    const result = guard.canActivate(context);
    return resolveGuardResult(result);
  }
}

function resolveGuardResult(result: ReturnType<CanActivate['canActivate']>): Promise<boolean> {
  if (typeof result === 'boolean') {
    return Promise.resolve(result);
  }
  if (result instanceof Promise) {
    return result;
  }
  return new Promise<boolean>((resolve, reject) => {
    result.subscribe({ next: resolve, error: reject });
  });
}
