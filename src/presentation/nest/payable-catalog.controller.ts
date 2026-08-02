import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { CatalogMutationOptions } from '../../application/builders/catalog-mutation-options';
import type { AuthorizationContext } from '../../application/policies/authorization-context';
import type { PriceDTO } from '../../domain/dtos/price.dto';
import type { ProductDTO } from '../../domain/dtos/product.dto';
import type { Payable } from '../../payable';
import { resolveCatalogIdempotencyHeader } from '../shared/catalog-idempotency';
import {
  catalogIdParamSchema,
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  productBodySchema,
  productUpdateBodySchema,
} from '../shared/schemas';
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

@Controller()
@UseFilters(PayableExceptionFilter)
export class PayableCatalogController {
  constructor(
    @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
    @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
  ) {}

  @Post('products')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  createProduct(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<ProductDTO> {
    const body = parseBody(productBodySchema, rawBody);
    return this.payable
      .products(undefined, this.tenantOf(request))
      .create(body, this.mutationOptionsOf(request));
  }

  @Patch('products')
  @UseGuards(PayableAuthGuard)
  updateProduct(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<ProductDTO> {
    const body = parseBody(productUpdateBodySchema, rawBody);
    return this.payable
      .products(undefined, this.tenantOf(request))
      .update(body, this.mutationOptionsOf(request));
  }

  @Post('products/:id/activate')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  activateProduct(
    @Req() request: PayableHttpRequest,
    @Param('id') id: string,
  ): Promise<ProductDTO> {
    const productId = parseBody(catalogIdParamSchema, { id }).id;
    return this.payable
      .products(undefined, this.tenantOf(request))
      .activate(productId, this.mutationOptionsOf(request));
  }

  @Post('products/:id/archive')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  archiveProduct(@Req() request: PayableHttpRequest, @Param('id') id: string): Promise<ProductDTO> {
    const productId = parseBody(catalogIdParamSchema, { id }).id;
    return this.payable
      .products(undefined, this.tenantOf(request))
      .archive(productId, this.mutationOptionsOf(request));
  }

  @Post('prices')
  @HttpCode(201)
  @UseGuards(PayableAuthGuard)
  createPrice(@Req() request: PayableHttpRequest, @Body() rawBody: unknown): Promise<PriceDTO> {
    const body = parseBody(priceBodySchema, rawBody);
    return this.payable.prices(undefined, this.tenantOf(request)).create(
      {
        providerProductId: body.providerProductId,
        unitAmount: parseMoneyInput(body.amount),
        interval: body.interval,
        intervalCount: body.intervalCount,
        description: body.description,
      },
      this.mutationOptionsOf(request),
    );
  }

  @Post('prices/:id/activate')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  activatePrice(@Req() request: PayableHttpRequest, @Param('id') id: string): Promise<PriceDTO> {
    const priceId = parseBody(catalogIdParamSchema, { id }).id;
    return this.payable
      .prices(undefined, this.tenantOf(request))
      .activate(priceId, this.mutationOptionsOf(request));
  }

  @Post('prices/:id/archive')
  @HttpCode(200)
  @UseGuards(PayableAuthGuard)
  archivePrice(@Req() request: PayableHttpRequest, @Param('id') id: string): Promise<PriceDTO> {
    const priceId = parseBody(catalogIdParamSchema, { id }).id;
    return this.payable
      .prices(undefined, this.tenantOf(request))
      .archive(priceId, this.mutationOptionsOf(request));
  }

  private authorizationOf(request: PayableHttpRequest): AuthorizationContext | undefined {
    return resolveAuthorization(this.options, request);
  }

  private mutationOptionsOf(request: PayableHttpRequest): CatalogMutationOptions {
    return {
      authorization: this.authorizationOf(request),
      idempotencyKey: resolveCatalogIdempotencyHeader({
        headers: request.headers,
        rawHeaders: rawHeadersOf(request),
      }),
    };
  }

  private tenantOf(request: PayableHttpRequest): string | null {
    return resolveTenantId(this.options, request);
  }
}

function rawHeadersOf(request: unknown): readonly string[] | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }
  if ('rawHeaders' in request && isStringArray(request.rawHeaders)) {
    return request.rawHeaders;
  }
  if ('raw' in request) {
    return rawHeadersOf(request.raw);
  }
  return undefined;
}

function isStringArray(candidate: unknown): candidate is string[] {
  return Array.isArray(candidate) && candidate.every((entry) => typeof entry === 'string');
}
