import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { corsConfig, rateLimitConfig, serverConfig } from '@/config';
import { isRedisAvailable, getRedis } from '@/infrastructure/cache/redis';

export async function setupPlugins(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    origin: corsConfig.origin.split(',').map(s => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: serverConfig.nodeEnv === 'production',
  });

  const rateLimitOpts: Record<string, unknown> = {
    max: rateLimitConfig.maxRequests,
    timeWindow: rateLimitConfig.windowMs,
    keyGenerator: (request: any) => {
      return request.headers['x-api-key'] as string || request.ip;
    },
  };

  if (isRedisAvailable()) {
    rateLimitOpts.redis = getRedis();
  }

  await fastify.register(rateLimit, rateLimitOpts as any);

  if (serverConfig.nodeEnv === 'development') {
    await fastify.register(swagger, {
      openapi: {
        info: {
          title: 'ProductWhisper NG API',
          description: 'Nigeria-first AI product intelligence platform',
          version: '1.0.0',
        },
        servers: [{ url: `http://localhost:${serverConfig.port}` }],
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
          },
        },
        security: [{ apiKey: [] }],
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }
}
