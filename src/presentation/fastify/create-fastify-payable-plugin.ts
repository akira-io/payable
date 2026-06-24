import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Payable } from '../../payable';
import { type FastifyPayableOptions, payableErrorReply } from './helpers';
import { registerCheckoutRoutes } from './routes/checkout.routes';
import { registerCustomerRoutes } from './routes/customers.routes';
import { registerPlaceholderRoutes } from './routes/placeholder.routes';
import { registerRefundRoutes } from './routes/refunds.routes';
import { registerSubscriptionRoutes } from './routes/subscriptions.routes';
import { registerWebhookRoutes } from './routes/webhooks.routes';

export function createFastifyPayablePlugin(
  payable: Payable,
  options: FastifyPayableOptions = {},
): FastifyPluginAsync {
  return async (fastify: FastifyInstance) => {
    fastify.setErrorHandler(payableErrorReply);
    await fastify.register(async (webhookScope) => {
      await registerWebhookRoutes(webhookScope, payable, options);
    });
    await fastify.register(async (authenticatedScope) => {
      if (options.authenticate) {
        authenticatedScope.addHook('onRequest', options.authenticate);
      }
      await registerCheckoutRoutes(authenticatedScope, payable, options);
      await registerSubscriptionRoutes(authenticatedScope, payable, options);
      await registerRefundRoutes(authenticatedScope, payable, options);
      await registerCustomerRoutes(authenticatedScope, payable, options);
      await registerPlaceholderRoutes(authenticatedScope, payable);
    });
  };
}
