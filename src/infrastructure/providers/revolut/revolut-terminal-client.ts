import { RevolutClient, type RevolutClientOptions } from './revolut-client';
import type { RevolutRequestOptions } from './revolut-types';

export type RevolutTerminalClientOptions = Omit<RevolutClientOptions, 'providerName'>;

export class RevolutTerminalClient {
  private readonly client: RevolutClient;

  constructor(options: RevolutTerminalClientOptions) {
    this.client = new RevolutClient({ ...options, providerName: 'revolut-terminal' });
  }

  request<T>(path: string, options: RevolutRequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }
}
