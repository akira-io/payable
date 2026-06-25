import { Router } from 'express';
import type { Payable } from '../../payable';
import { type ExpressPayableOptions, payableErrorHandler } from './helpers';
import { registerCheckoutRoutes } from './routes/checkout.routes';
import { registerCustomerRoutes } from './routes/customers.routes';
import { registerInvoiceRoutes } from './routes/invoices.routes';
import { registerPaymentRoutes } from './routes/payments.routes';
import { registerRefundRoutes } from './routes/refunds.routes';
import { registerSubscriptionRoutes } from './routes/subscriptions.routes';
import { registerWebhookRoutes } from './routes/webhooks.routes';

export function createExpressPayableRoutes(
  payable: Payable,
  options: ExpressPayableOptions = {},
): Router {
  const router = Router();
  registerWebhookRoutes(router, payable, options);
  if (options.authenticate) {
    router.use(options.authenticate);
  }
  registerCheckoutRoutes(router, payable, options);
  registerSubscriptionRoutes(router, payable, options);
  registerCustomerRoutes(router, payable, options);
  registerInvoiceRoutes(router, payable, options);
  registerPaymentRoutes(router, payable, options);
  registerRefundRoutes(router, payable, options);
  router.use(payableErrorHandler);
  return router;
}
