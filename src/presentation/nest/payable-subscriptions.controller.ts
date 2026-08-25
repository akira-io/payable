import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Payable } from '../../payable';
import { rawHeadersOf, requireRequestIdempotencyKey } from '../shared/catalog-idempotency';
import {
  runSubscriptionPriceMigrationAction,
  runSubscriptionPriceMigrationList,
  runSubscriptionPriceMigrationPreview,
  runSubscriptionPriceMigrationRetrieve,
  type SubscriptionPriceMigrationAction,
} from '../shared/operations';
import {
  parseBody,
  subscriptionPriceMigrationIdParamSchema,
  subscriptionPriceMigrationListQuerySchema,
  subscriptionPriceMigrationOperationBodySchema,
  subscriptionPriceMigrationPreviewBodySchema,
} from '../shared/schemas';
import { SubscriptionMigrationMutationBoundary } from '../shared/subscription-migration-boundary';
import {
  type NestPayableOptions,
  PAYABLE_INSTANCE,
  PAYABLE_OPTIONS,
  type PayableHttpRequest,
  resolveAuthorization,
  resolveTenantId,
} from './payable.constants';
import { PayableExceptionFilter } from './payable.exception-filter';
import { PayableAuthGuard } from './payable-auth.guard';
import { assertNestPayableBodyParser } from './payable-body-parser';

@Controller('canonical/subscription-price-migrations')
@UseFilters(PayableExceptionFilter)
@UseGuards(PayableAuthGuard)
export class PayableSubscriptionsController {
  private readonly mutationBoundary: SubscriptionMigrationMutationBoundary;

  constructor(
    @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
  ) {
    this.mutationBoundary = new SubscriptionMigrationMutationBoundary(
      options.subscriptionPriceMigrationLimits,
    );
  }

  @Post()
  @HttpCode(200)
  create(@Req() request: PayableHttpRequest, @Body() rawBody: unknown) {
    const access = this.mutationAccess(request);
    const body = parseBody(subscriptionPriceMigrationPreviewBodySchema, rawBody);
    return runSubscriptionPriceMigrationPreview(
      this.payable,
      body,
      access.tenantId,
      access.authorization,
      requestIdempotencyKey(request),
    );
  }

  @Get()
  list(@Req() request: PayableHttpRequest, @Query() rawQuery: unknown) {
    return runSubscriptionPriceMigrationList(
      this.payable,
      parseBody(subscriptionPriceMigrationListQuerySchema, rawQuery),
      this.tenantOf(request),
      this.authorizationOf(request),
    );
  }

  @Get(':id')
  retrieve(@Req() request: PayableHttpRequest, @Param('id') rawId: string) {
    const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, { id: rawId });
    return runSubscriptionPriceMigrationRetrieve(
      this.payable,
      id,
      this.tenantOf(request),
      this.authorizationOf(request),
    );
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Req() request: PayableHttpRequest,
    @Param('id') rawId: string,
    @Body() rawBody: unknown,
  ) {
    return this.mutate('approve', request, rawId, rawBody);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() request: PayableHttpRequest, @Param('id') rawId: string, @Body() rawBody: unknown) {
    return this.mutate('cancel', request, rawId, rawBody);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Req() request: PayableHttpRequest, @Param('id') rawId: string, @Body() rawBody: unknown) {
    return this.mutate('retry', request, rawId, rawBody);
  }

  private mutate(
    action: SubscriptionPriceMigrationAction,
    request: PayableHttpRequest,
    rawId: string,
    rawBody: unknown,
  ) {
    const access = this.mutationAccess(request);
    parseBody(subscriptionPriceMigrationOperationBodySchema, rawBody);
    const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, { id: rawId });
    return runSubscriptionPriceMigrationAction(
      this.payable,
      action,
      id,
      access.tenantId,
      access.authorization,
      requestIdempotencyKey(request),
    );
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return resolveTenantId(this.options, request);
  }

  private authorizationOf(request: PayableHttpRequest) {
    return resolveAuthorization(this.options, request);
  }

  private mutationAccess(request: PayableHttpRequest) {
    assertNestPayableBodyParser(request, this.options.subscriptionPriceMigrationLimits);
    const tenantId = this.tenantOf(request);
    const authorization = this.authorizationOf(request);
    this.mutationBoundary.enforceRate({
      tenantId,
      actorId: authorization?.actorId,
    });
    return { tenantId, authorization };
  }
}

function requestIdempotencyKey(request: PayableHttpRequest): string {
  return requireRequestIdempotencyKey({
    headers: request.headers,
    rawHeaders: rawHeadersOf(request),
  });
}
