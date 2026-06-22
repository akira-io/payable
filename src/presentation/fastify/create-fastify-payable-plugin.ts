import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Payable } from '../../payable';
import { type FastifyPayableOptions, payableErrorReply } from './helpers';
import { registerCheckoutRoutes } from './routes/checkout.routes';
import { registerPlaceholderRoutes } from './routes/placeholder.routes';
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
    await registerCheckoutRoutes(fastify, payable);
    await registerSubscriptionRoutes(fastify, payable);
    await registerPlaceholderRoutes(fastify, payable);
  };
}
