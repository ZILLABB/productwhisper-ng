import { FastifyInstance } from 'fastify';
import { productRoutes } from './products';
import { priceRoutes } from './prices';
import { sentimentRoutes } from './sentiment';
import { trustRoutes } from './trust';
import { searchRoutes } from './search';
import { adminRoutes } from './admin';
import { apiKeyAuth } from '@/api/middleware/auth';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', apiKeyAuth);

  fastify.register(productRoutes, { prefix: '/products' });
  fastify.register(priceRoutes, { prefix: '/prices' });
  fastify.register(sentimentRoutes, { prefix: '/sentiment' });
  fastify.register(trustRoutes, { prefix: '/trust' });
  fastify.register(searchRoutes, { prefix: '/search' });
  fastify.register(adminRoutes, { prefix: '/admin' });
}
