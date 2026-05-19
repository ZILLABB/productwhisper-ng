import { FastifyInstance } from 'fastify';
import { IngestionService } from '@/core/services/IngestionService';
import { addScrapingJob } from '@/infrastructure/queue/bullmq';
import { healthCheckDatabase } from '@/infrastructure/database/prisma';
import { healthCheckRedis, getRedis } from '@/infrastructure/cache/redis';
import { SentimentService } from '@/core/services/SentimentService';
import { successResponse } from '@/shared/utils';

const ingestion = new IngestionService();
const sentiment = new SentimentService();

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/ingest', async (request, reply) => {
    const { platform, query, maxResults } = request.body as {
      platform: string;
      query: string;
      maxResults?: number;
    };

    if (!platform || !query) {
      return reply.status(400).send({
        success: false,
        error: 'platform and query are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const validPlatforms = ['JUMIA', 'KONGA', 'JIJI'];
    if (!validPlatforms.includes(platform.toUpperCase())) {
      return reply.status(400).send({
        success: false,
        error: `platform must be one of: ${validPlatforms.join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await ingestion.ingestFromPlatform(
      platform.toUpperCase(),
      query,
      maxResults ? Math.min(maxResults, 100) : 50
    );

    return reply.send(successResponse(result));
  });

  fastify.post('/ingest/nairaland', async (request, reply) => {
    const { query, maxPages } = request.body as { query: string; maxPages?: number };

    if (!query) {
      return reply.status(400).send({
        success: false,
        error: 'query is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await ingestion.ingestNairalandDiscussions(query, maxPages ? Math.min(maxPages, 10) : 3);

    return reply.send(successResponse(result));
  });

  fastify.post('/ingest/queue', async (request, reply) => {
    const { platform, query, maxResults } = request.body as {
      platform: string;
      query: string;
      maxResults?: number;
    };

    if (!platform || !query) {
      return reply.status(400).send({
        success: false,
        error: 'platform and query are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const job = await addScrapingJob(platform.toUpperCase(), { query, maxResults: maxResults ?? 50 });

    return reply.send(successResponse({
      jobId: job.id,
      message: 'Ingestion job queued',
    }));
  });

  fastify.get('/ingestion/status', async (request, reply) => {
    const status = await ingestion.getIngestionStatus();
    return reply.send(successResponse(status));
  });

  fastify.get('/health', async (request, reply) => {
    const [dbHealthy, redisHealthy, sentimentHealthy] = await Promise.all([
      healthCheckDatabase(),
      healthCheckRedis(),
      sentiment.healthCheck(),
    ]);

    const overall = dbHealthy && redisHealthy;

    return reply.status(overall ? 200 : 503).send(successResponse({
      status: overall ? 'healthy' : 'degraded',
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        sentiment: sentimentHealthy ? 'up' : 'degraded',
      },
      timestamp: new Date().toISOString(),
    }));
  });

  fastify.delete('/cache', async (request, reply) => {
    const { pattern } = request.query as { pattern?: string };
    const redis = getRedis();

    if (pattern) {
      let cursor = '0';
      let deleted = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      return reply.send(successResponse({ deleted, pattern }));
    }

    await redis.flushdb();
    return reply.send(successResponse({ message: 'Cache flushed' }));
  });
}
