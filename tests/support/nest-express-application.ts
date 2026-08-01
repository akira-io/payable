import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { AbstractHttpAdapter, type IEntryNestModule, NestFactory } from '@nestjs/core';
import express, { type Request, type Response } from 'express';

type ExpressAdapterBase = AbstractHttpAdapter<Server, Request, Response>;
type ErrorHandler = Parameters<ExpressAdapterBase['setErrorHandler']>[0];
type NotFoundHandler = Parameters<ExpressAdapterBase['setNotFoundHandler']>[0];
type MiddlewareFactory = ExpressAdapterBase['createMiddlewareFactory'];
type VersionFilter = ExpressAdapterBase['applyVersionFilter'];
type VersionFilterHandler = Parameters<VersionFilter>[0];
type VersionFilterOptions =
  Parameters<VersionFilter> extends [unknown, ...infer Rest] ? Rest : never;

class ExpressTestAdapter extends AbstractHttpAdapter<Server, Request, Response> {
  constructor() {
    super(express());
  }

  close(): Promise<void> {
    const server = this.getHttpServer();
    if (!server.listening) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  initHttpServer(): void {
    this.setHttpServer(createServer(this.getInstance()));
  }

  useStaticAssets(...args: unknown[]): void {
    const root = args[0];
    if (typeof root === 'string') {
      this.use(express.static(root));
    }
  }

  setViewEngine(engine: string): void {
    this.getInstance().set('view engine', engine);
  }

  getRequestHostname(request: Request): string {
    return request.hostname;
  }

  getRequestMethod(request: Request): string {
    return request.method;
  }

  getRequestUrl(request: Request): string {
    return request.url;
  }

  status(response: Response, statusCode: number): Response {
    return response.status(statusCode);
  }

  reply(response: Response, body: unknown, statusCode = 200): Response {
    return response.status(statusCode).send(body);
  }

  end(response: Response, message?: string): Response {
    return response.end(message);
  }

  render(response: Response, view: string, options: unknown): void {
    response.render(view, typeof options === 'object' && options !== null ? options : undefined);
  }

  redirect(response: Response, statusCode: number, url: string): void {
    response.redirect(statusCode, url);
  }

  setErrorHandler(handler: ErrorHandler): void {
    this.getInstance().use(handler as express.RequestHandler);
  }

  setNotFoundHandler(handler: NotFoundHandler): void {
    this.getInstance().use(handler as express.RequestHandler);
  }

  isHeadersSent(response: Response): boolean {
    return response.headersSent;
  }

  getHeader(response: Response, name: string): number | string | string[] | undefined {
    return response.get(name);
  }

  setHeader(response: Response, name: string, value: string): Response {
    return response.setHeader(name, value);
  }

  appendHeader(response: Response, name: string, value: string): Response {
    return response.append(name, value);
  }

  registerParserMiddleware(): void {
    this.use(express.json());
    this.use(express.urlencoded({ extended: true }));
  }

  enableCors(): void {}

  createMiddlewareFactory(..._args: Parameters<MiddlewareFactory>): ReturnType<MiddlewareFactory> {
    return ((path: string, callback: unknown) =>
      this.use(path, callback as express.RequestHandler)) as ReturnType<MiddlewareFactory>;
  }

  getType(): string {
    return 'express';
  }

  applyVersionFilter(
    handler: VersionFilterHandler,
    ..._args: VersionFilterOptions
  ): ReturnType<VersionFilter> {
    const requestHandler = handler as unknown as (
      request: Request,
      response: Response,
      next: () => void,
    ) => unknown;
    return ((request: Request, response: Response, next: () => void) =>
      requestHandler(request, response, next)) as ReturnType<VersionFilter>;
  }
}

export async function createNestExpressApplication(
  module: IEntryNestModule,
): Promise<INestApplication> {
  const application = await NestFactory.create(module, new ExpressTestAdapter(), { logger: false });
  await application.init();
  return application;
}
