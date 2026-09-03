import type { Logger } from '../../../domain/contracts/logger.contract';

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  logger?: Logger;
}
