import type Stripe from 'stripe';
import type {
  IdentityProvider,
  IdentityVerificationCapable,
} from '../../../domain/contracts/identity-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateIdentityVerificationInput,
  IdentityCapabilities,
  IdentityVerificationDTO,
} from '../../../domain/dtos/identity.dto';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import {
  mapStripeIdentityVerification,
  stripeIdentityVerificationParams,
} from './stripe-identity-mappers';

export interface StripeIdentityProviderOptions {
  secretKey: string;
}

export class StripeIdentityProvider implements IdentityProvider, IdentityVerificationCapable {
  readonly name = 'stripe-identity';
  private client?: Stripe;

  constructor(
    private readonly options: StripeIdentityProviderOptions,
    client?: unknown,
  ) {
    this.client = client as Stripe | undefined;
  }

  capabilities(): IdentityCapabilities {
    return new Set(['verificationSessions']);
  }

  async createIdentityVerification(
    input: CreateIdentityVerificationInput,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO> {
    const params = stripeIdentityVerificationParams(input);
    const stripe = await this.stripe();
    const session = await withStripeErrors(
      () =>
        stripe.identity.verificationSessions.create(params, {
          idempotencyKey: ctx.idempotencyKey,
        }),
      this.name,
    );
    return mapStripeIdentityVerification(session);
  }

  async retrieveIdentityVerification(
    providerVerificationId: string,
  ): Promise<IdentityVerificationDTO> {
    const stripe = await this.stripe();
    const session = await withStripeErrors(
      () => stripe.identity.verificationSessions.retrieve(providerVerificationId),
      this.name,
    );
    return mapStripeIdentityVerification(session);
  }

  async cancelIdentityVerification(
    providerVerificationId: string,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO> {
    const stripe = await this.stripe();
    const session = await withStripeErrors(
      () =>
        stripe.identity.verificationSessions.cancel(
          providerVerificationId,
          {},
          this.idempotency(ctx),
        ),
      this.name,
    );
    return mapStripeIdentityVerification(session);
  }

  async redactIdentityVerification(
    providerVerificationId: string,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO> {
    const stripe = await this.stripe();
    const session = await withStripeErrors(
      () =>
        stripe.identity.verificationSessions.redact(
          providerVerificationId,
          {},
          this.idempotency(ctx),
        ),
      this.name,
    );
    return mapStripeIdentityVerification(session);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeIdentityProvider { name: '${this.name}' }`;
  }

  private idempotency(ctx: OperationContext): Stripe.RequestOptions {
    return { idempotencyKey: ctx.idempotencyKey };
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }
}
