import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { SubscriptionChangeTiming } from '../../domain/dtos/subscription-change.dto';
import type {
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
} from '../../domain/dtos/subscription-operation-capabilities.dto';
import type { SubscriptionPriceMigration } from '../../domain/entities/subscription-price-migration.entity';
import type { SubscriptionPriceMigrationStatus } from '../../domain/value-objects/subscription-price-migration-status';
export interface PreviewPriceMigrationInput {
  subscriptionId: string;
  targetPriceId: string;
  itemId?: string;
  quantity?: number;
  idempotencyKey: string;
  timing: SubscriptionChangeTiming;
  prorationPolicy: SubscriptionProrationPolicy;
  paymentFailurePolicy: SubscriptionPaymentFailurePolicy;
}

export interface SubscriptionPriceMigrationOperationInput {
  idempotencyKey: string;
}

export interface ResolveSubscriptionPriceMigrationInput
  extends SubscriptionPriceMigrationOperationInput {
  outcome: 'applied' | 'not_applied' | 'unknown';
  evidenceReference: string;
}

export interface DueSubscriptionPriceMigrationsInput {
  dueBefore: Date;
  limit?: number;
  cursor?: string;
}

export interface ListSubscriptionPriceMigrationsInput {
  limit?: number;
  cursor?: string;
  subscriptionId?: string;
  status?: SubscriptionPriceMigrationStatus;
}

export interface SubscriptionPriceMigrationResource {
  preview(input: PreviewPriceMigrationInput): Promise<SubscriptionPriceMigration>;
  retrieve(id: string): Promise<SubscriptionPriceMigration>;
  approve(
    id: string,
    input: SubscriptionPriceMigrationOperationInput,
  ): Promise<SubscriptionPriceMigration>;
  execute(
    id: string,
    input: SubscriptionPriceMigrationOperationInput,
  ): Promise<SubscriptionPriceMigration>;
  settle(
    id: string,
    input: SubscriptionPriceMigrationOperationInput,
  ): Promise<SubscriptionPriceMigration>;
  retry(
    id: string,
    input: SubscriptionPriceMigrationOperationInput,
  ): Promise<SubscriptionPriceMigration>;
  cancel(
    id: string,
    input: SubscriptionPriceMigrationOperationInput,
  ): Promise<SubscriptionPriceMigration>;
  resolve(
    id: string,
    input: ResolveSubscriptionPriceMigrationInput,
  ): Promise<SubscriptionPriceMigration>;
  due(
    input: DueSubscriptionPriceMigrationsInput,
  ): Promise<CollectionPage<SubscriptionPriceMigration>>;
  list(
    input?: ListSubscriptionPriceMigrationsInput,
  ): Promise<CollectionPage<SubscriptionPriceMigration>>;
}
