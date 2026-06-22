import { Payable } from './payable';
import { type PayableConfig, resolveConfig } from './support/config/payable-config';

export function createPayable(config: PayableConfig): Payable {
  return new Payable(resolveConfig(config));
}
