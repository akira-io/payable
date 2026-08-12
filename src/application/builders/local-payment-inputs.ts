import type { CollectionMethod } from '../../domain/entities/payment.entity';
import type { Money } from '../../domain/value-objects/money';
import type { AuthorizationContext } from '../policies/authorization-context';

export interface RecordLocalPaymentInput {
  customerId: string;
  amount: Money;
  status: 'pending' | 'succeeded';
  collectionMethod: CollectionMethod;
  occurredAt?: Date;
  externalReference?: string;
  description?: string;
  authorization?: AuthorizationContext;
  idempotencyKey?: string;
}

export interface RecordLocalRefundInput {
  amount?: Money;
  collectionMethod: CollectionMethod;
  occurredAt?: Date;
  externalReference?: string;
  confirmedExternally?: boolean;
  reason?: string;
  authorization?: AuthorizationContext;
  idempotencyKey?: string;
}

export interface TransitionLocalPaymentInput {
  authorization?: AuthorizationContext;
  idempotencyKey?: string;
}
