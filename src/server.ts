import Fastify from 'fastify';
import { serverConfig } from '@/config';
import { setupPlugins } from '@/api/plugins';
import { registerRoutes } from '@/api/routes';
import { errorHandler } from '@/api/middleware/errorHandler';
import { connectDatabase, disconnectDatabase } from '@/infrastructure/database/prisma';
import { connectRedis, disconnectRedis, isRedisAvailable } from '@/infrastructure/cache/redis';
import { closeAllQueues } from '@/infrastructure/queue/bullmq';
import { SchedulerService } from '@/core/services/SchedulerService';

const scheduler = new SchedulerService();

const fastify = Fastify({
  logger: {
    level: serverConfig.nodeEnv === 'production' ? 'info' : 'debug',
    transport: serverConfig.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
  requestIdHeader: 'x-request-id',
  genReqId: () => crypto.randomUUID(),
  maxParamLength: 600, // Support long product slugs (default 100 is too short)
});

fastify.setErrorHandler(errorHandler);

async function start(): Promise<void> {
  try {
    await connectDatabase();
    fastify.log.info('Database connected');

    await connectRedis();
    fastify.log.info('Redis connected');

    await setupPlugins(fastify);
    fastify.log.info('Plugins registered');

    await fastify.register(registerRoutes, { prefix: '/api/v1' });
    fastify.log.info('Routes registered');

    fastify.get('/health', async () => ({
      status: 'ok',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    }));

    await fastify.listen({ port: serverConfig.port, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${serverConfig.port}`);

    // Start built-in scheduler if Redis/BullMQ workers aren't available
    if (!isRedisAvailable()) {
      fastify.log.info('Redis unavailable — starting built-in scheduler for scraping & analysis');
      scheduler.start();
    } else {
      fastify.log.info('Redis available — use BullMQ workers for scheduled jobs (npx tsx src/workers/index.ts)');
    }

    if (serverConfig.nodeEnv === 'development') {
      fastify.log.info(`Swagger docs at http://localhost:${serverConfig.port}/docs`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  fastify.log.info('Shutting down...');
  scheduler.stop();
  await fastify.close();
  await closeAllQueues();
  await disconnectRedis();
  await disconnectDatabase();
  fastify.log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
