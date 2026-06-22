import type { Billable } from './application/builders/billable';
import { CustomerContext } from './application/builders/customer-context';
import type { Clock } from './domain/contracts/clock.contract';
import type { EventBus } from './domain/contracts/event-bus.contract';
import type { Logger } from './domain/contracts/logger.contract';
import type { PaymentProvider } from './domain/contracts/payment-provider.contract';
import type { RefundResultDTO } from './domain/dtos/refund.dto';
import { PayableError } from './domain/errors/payable-error';
import { ProviderNotFoundError } from './domain/errors/provider-not-found.error';
import type { Money } from './domain/value-objects/money';
import type { ResolvedConfig } from './support/config/payable-config';

export interface RefundRequest {
  paymentId: string;
  amount?: Money;
  reason?: string;
}

export class ProviderRegistry {
  constructor(private readonly providers: Map<string, PaymentProvider>) {}

  register(name: string, provider: PaymentProvider): void {
    this.providers.set(name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderNotFoundError(name);
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}

export class Payable {
  private readonly registry: ProviderRegistry;

  constructor(private readonly resolved: ResolvedConfig) {
    this.registry = new ProviderRegistry(resolved.providers);
  }

  providers(): ProviderRegistry {
    return this.registry;
  }

  events(): EventBus {
    return this.resolved.events;
  }

  clock(): Clock {
    return this.resolved.clock;
  }

  logger(): Logger {
    return this.resolved.logger;
  }

  tenantEnabled(): boolean {
    return this.resolved.tenantEnabled;
  }

  customer(billable: Billable): CustomerContext {
    return new CustomerContext(billable);
  }

  // TODO: Phase 10 - issue a refund through the provider.
  async refund(request: RefundRequest): Promise<RefundResultDTO> {
    throw PayableError.notImplemented(`Payable.refund (${request.paymentId})`);
  }
}
