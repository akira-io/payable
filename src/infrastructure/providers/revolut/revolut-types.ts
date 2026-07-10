export type RevolutEnvironment = 'sandbox' | 'production';

export type RevolutFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RevolutRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

export type RevolutRequest = <T>(path: string, options: RevolutRequestOptions) => Promise<T>;

export interface RevolutCustomer {
  id: string;
  email?: string | null;
  full_name?: string | null;
}

export interface RevolutCustomerCreationPayload {
  email: string;
  full_name?: string;
}

export interface RevolutCustomerUpdatePayload {
  email?: string;
  full_name?: string;
}

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
  customer?: { id: string };
  merchant_order_data?: { reference: string };
  redirect_url?: string;
}

export interface RevolutRefundPayload {
  amount: number;
  currency: string;
  description?: string;
  merchant_order_data?: { reference: string };
}

export interface RevolutSubscription {
  id: string;
  state?: string;
  customer_id?: string;
  plan_id?: string;
  plan_variation_id?: string;
  payment_method_type?: string;
  created_at?: string;
  updated_at?: string;
  current_cycle_id?: string;
  trial_end_date?: string;
  setup_order_id?: string;
}

export interface RevolutSubscriptionCreationPayload {
  plan_variation_id: string;
  customer_id: string;
  external_reference?: string;
  setup_order_redirect_url?: string;
  trial_duration?: string;
}

export interface RevolutSubscriptionChangePlanPayload {
  plan_variation_id: string;
  scheduled: 'at_cycle_end';
}

export interface RevolutWebhookPayload {
  event: string;
  order_id?: string;
  subscription_id?: string;
  merchant_order_ext_ref?: string;
  external_reference?: string;
  [key: string]: unknown;
}
