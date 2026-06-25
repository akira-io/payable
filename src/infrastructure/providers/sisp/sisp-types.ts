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

export interface SispTransactionRecord {
  id: number;
  merchant_ref: string;
  amount: number;
  currency: string;
  status: string;
  transaction_id: string | null;
}

export interface SispRefundBuilder {
  amount(value: number): SispRefundBuilder;
  full(): SispRefundBuilder;
  reason(reason: string): SispRefundBuilder;
  process(): Promise<SispTransactionRecord>;
}

export interface SispDriver {
  paymentEndpoint(): string;
}

export type SispCallbackPayload = Record<string, unknown>;

export interface SispConfigView {
  generators: { merchantReference(): string };
}

export interface SispClient {
  config: SispConfigView;
  handlers: { handlePayment(request: SispHttpRequestInfo): Promise<SispHttpResult> };
  driver(name?: string | null): SispDriver;
  models: {
    transactions: { findByRef(merchantRef: string): Promise<SispTransactionRecord | null> };
  };
  refund(transaction: SispTransactionRecord): SispRefundBuilder;
  validateCallback(payload: SispCallbackPayload): boolean;
  handlePaymentCallback(payload: SispCallbackPayload): Promise<SispTransactionRecord>;
}
