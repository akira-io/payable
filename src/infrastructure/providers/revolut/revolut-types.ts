export type RevolutEnvironment = 'sandbox' | 'production';

export type RevolutFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RevolutOrder {
  id: string;
  type?: string;
  state?: string;
  amount?: number;
  currency?: string;
  checkout_url?: string;
  related_order_id?: string;
}

export interface RevolutOrderCreationPayload {
  amount: number;
  currency: string;
  redirect_url?: string;
}

export interface RevolutRefundPayload {
  amount: number;
  currency: string;
  description?: string;
}

export interface RevolutWebhookPayload {
  event: string;
  order_id?: string;
  merchant_order_ext_ref?: string;
  [key: string]: unknown;
}
