import type { Logger } from '../../../domain/contracts/logger.contract';
import type { RevolutEnvironment, RevolutFetch } from './revolut-types';

export interface RevolutProviderOptions {
  secretKey: string;
  webhookSecret: string;
  environment?: RevolutEnvironment;
  baseUrl?: string;
  apiVersion?: string;
  webhookToleranceMs?: number;
  logger?: Logger;
  fetch?: RevolutFetch;
  timeoutMs?: number;
}
