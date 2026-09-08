export interface SispHttpRequestInfo {
  ip: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
}

export type SispHttpResult =
  | { type: 'html'; status: number; html: string }
  | { type: 'json'; status: number; data: unknown }
  | { type: 'redirect'; location: string };

export type SispCallbackPayload = Record<string, unknown>;

export interface SispNormalizedCallbackPayload {
  readonly merchantRef: string;
  readonly merchantSession: string;
  readonly amount: string | number;
  readonly currency: string;
  readonly transactionCode: string;
  readonly transactionID: string | number;
}

export interface SispCallbackOutcome {
  readonly verified: boolean;
  readonly status: string;
  readonly reason: string | null;
  readonly payload: SispNormalizedCallbackPayload;
}

export interface SispPaymentRequest {
  readonly merchantRef: string;
  readonly merchantSession: string;
  readonly amount: number;
  readonly currency: string;
  readonly transactionCode: string;
}

export interface SispExpectedPayment {
  readonly amount: string | number;
  readonly currency?: string;
  readonly transactionCode?: string;
}

export type SispCorrelationClaim =
  | { status: 'claimed'; payment: SispExpectedPayment }
  | { status: 'missing' }
  | { status: 'already_processed' };

export interface SispPaymentCorrelationStore {
  record(request: SispPaymentRequest): Promise<void>;
  claim(merchantRef: string, merchantSession: string): Promise<SispCorrelationClaim>;
  markProcessed(
    merchantRef: string,
    merchantSession: string,
    outcome: SispCallbackOutcome,
  ): Promise<void>;
}

export interface SispDriver {
  paymentEndpoint(): string;
}

export interface SispConfigView {
  generators: { merchantReference(): string };
}

export interface SispClient {
  config: SispConfigView;
  handlers: { handlePayment(request: SispHttpRequestInfo): Promise<SispHttpResult> };
  driver(name?: string | null): SispDriver;
  validateCallback(payload: SispNormalizedCallbackPayload): boolean;
  handleCallback(payload: SispNormalizedCallbackPayload): Promise<SispCallbackOutcome>;
}

export interface SispModule {
  createStatelessSisp(config: unknown): SispClient;
  callbackPayloadFrom(data: Record<string, unknown>): SispNormalizedCallbackPayload;
}
