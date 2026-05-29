import { FastifyInstance } from 'fastify';
import { IngestionService } from '@/core/services/IngestionService';
import { SchedulerService } from '@/core/services/SchedulerService';
import { addScrapingJob, getQueue } from '@/infrastructure/queue/bullmq';
import { healthCheckDatabase } from '@/infrastructure/database/prisma';
import { healthCheckRedis, getRedis, isRedisAvailable } from '@/infrastructure/cache/redis';
import { SentimentService } from '@/core/services/SentimentService';
import { sentimentEngine } from '@/core/services/NigerianSentimentEngine';
import { QUEUE_NAMES } from '@/shared/constants';
import { successResponse } from '@/shared/utils';
import { prisma } from '@/infrastructure/database/prisma';

const ingestion = new IngestionService();
const sentiment = new SentimentService();
const scheduler = new SchedulerService();

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {

  // ─── Ingestion: Direct Scrape ────────────────────────
  // Long timeout — enrichment fetches details+reviews per product
  fastify.post('/ingest', { config: { requestTimeout: 300_000 } } as any, async (request, reply) => {
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

  // ─── Ingestion: Nairaland Discussions ────────────────
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

  // ─── Ingestion: Queue a Job ──────────────────────────
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

  // ─── Ingestion Status ────────────────────────────────
  fastify.get('/ingestion/status', async (request, reply) => {
    const status = await ingestion.getIngestionStatus();
    return reply.send(successResponse(status));
  });

  // ─── Enhanced Health Check ───────────────────────────
  fastify.get('/health', async (request, reply) => {
    const [dbHealthy, redisHealthy, sentimentHealth] = await Promise.all([
      healthCheckDatabase(),
      healthCheckRedis(),
      sentiment.healthCheck(),
    ]);

    // Check queue connectivity
    let queuesHealthy = false;
    try {
      if (isRedisAvailable()) {
        const q = getQueue(QUEUE_NAMES.SCRAPING);
        await q.getJobCounts();
        queuesHealthy = true;
      }
    } catch {
      queuesHealthy = false;
    }

    const overall = dbHealthy; // DB is the only hard requirement

    return reply.status(overall ? 200 : 503).send(successResponse({
      status: overall ? (redisHealthy ? 'healthy' : 'degraded') : 'unhealthy',
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down (using memory fallback)',
        queues: queuesHealthy ? 'up' : 'down (jobs won\'t process)',
        sentiment: {
          external: sentimentHealth.external ? 'up' : 'down',
          builtin: sentimentHealth.builtin ? 'up' : 'down',
          status: sentimentHealth.overall ? 'operational' : 'degraded',
        },
      },
      timestamp: new Date().toISOString(),
    }));
  });

  // ─── Queue Status ────────────────────────────────────
  fastify.get('/queues', async (request, reply) => {
    const queueNames = Object.values(QUEUE_NAMES);
    const queueStats: Record<string, unknown> = {};

    for (const name of queueNames) {
      try {
        const q = getQueue(name);
        const counts = await q.getJobCounts();
        queueStats[name] = {
          ...counts,
          isPaused: await q.isPaused(),
        };
      } catch (err) {
        queueStats[name] = {
          error: 'Queue unavailable (Redis may be down)',
        };
      }
    }

    return reply.send(successResponse({
      queues: queueStats,
      redisConnected: isRedisAvailable(),
    }));
  });

  // ─── Sentiment: Test Analysis ────────────────────────
  // Lets you test the built-in sentiment engine directly
  fastify.post('/sentiment/test', async (request, reply) => {
    const { text, rating } = request.body as { text: string; rating?: number };

    if (!text) {
      return reply.status(400).send({
        success: false,
        error: 'text is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = sentimentEngine.analyze(text, 'product_review', rating);

    return reply.send(successResponse({
      input: { text: text.substring(0, 200), rating },
      analysis: result,
    }));
  });

  // ─── Sentiment: Re-analyze all unanalyzed reviews ────
  fastify.post('/sentiment/reanalyze', async (request, reply) => {
    const { limit } = request.body as { limit?: number } || {};
    const batchLimit = Math.min(limit ?? 100, 500);

    // Find reviews without sentiment analysis
    const unanalyzed = await prisma.review.findMany({
      where: { sentimentAnalysis: null },
      select: {
        id: true,
        listing: { select: { productId: true } },
      },
      take: batchLimit,
    });

    if (unanalyzed.length === 0) {
      return reply.send(successResponse({
        message: 'No unanalyzed reviews found',
        processed: 0,
      }));
    }

    // Group by product
    const byProduct = new Map<string, string[]>();
    for (const review of unanalyzed) {
      const productId = review.listing.productId;
      const list = byProduct.get(productId) ?? [];
      list.push(review.id);
      byProduct.set(productId, list);
    }

    let totalProcessed = 0;
    for (const [productId, reviewIds] of byProduct) {
      const processed = await sentiment.analyzeAndStoreReviews(productId, reviewIds);
      totalProcessed += processed;
    }

    return reply.send(successResponse({
      message: `Analyzed ${totalProcessed} reviews across ${byProduct.size} products`,
      processed: totalProcessed,
      products: byProduct.size,
    }));
  });

  // ─── Database Stats ──────────────────────────────────
  fastify.get('/stats', async (request, reply) => {
    const [
      productCount,
      listingCount,
      reviewCount,
      vendorCount,
      sentimentCount,
      trustCount,
      jobCount,
      searchCount,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.productListing.count(),
      prisma.review.count(),
      prisma.vendor.count(),
      prisma.sentimentAnalysis.count(),
      prisma.trustScore.count(),
      prisma.scrapingJob.count(),
      prisma.searchAnalytics.count(),
    ]);

    // Reviews without sentiment analysis
    const unanalyzedReviews = await prisma.review.count({
      where: { sentimentAnalysis: null },
    });

    // Recent scraping activity
    const recentJobs = await prisma.scrapingJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        type: true,
        platform: true,
        status: true,
        completedAt: true,
        createdAt: true,
      },
    });

    // Platform breakdown
    const platformStats = await prisma.productListing.groupBy({
      by: ['platform'],
      _count: { id: true },
    });

    return reply.send(successResponse({
      counts: {
        products: productCount,
        listings: listingCount,
        reviews: reviewCount,
        vendors: vendorCount,
        sentimentAnalyses: sentimentCount,
        trustScores: trustCount,
        scrapingJobs: jobCount,
        searchQueries: searchCount,
        unanalyzedReviews,
      },
      platforms: platformStats.map(p => ({
        platform: p.platform,
        listings: p._count.id,
      })),
      recentJobs,
    }));
  });

  // ─── Cache Management ────────────────────────────────
  fastify.delete('/cache', async (request, reply) => {
    const { pattern } = request.query as { pattern?: string };

    if (!isRedisAvailable()) {
      return reply.send(successResponse({
        message: 'Redis unavailable — in-memory cache cannot be selectively cleared',
        deleted: 0,
      }));
    }

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

  // ─── Run Full Scrape Cycle Now ──────────────────────
  // Triggers the built-in scheduler's full cycle (scrape + sentiment + trust)
  fastify.post('/scheduler/run', { config: { requestTimeout: 600_000 } } as any, async (request, reply) => {
    reply.send(successResponse({ message: 'Scrape cycle started in background' }));
    // Fire-and-forget — don't block the response
    setImmediate(() => scheduler.runCycle());
  });

  // ─── Run Sentiment Reanalysis + Trust Recompute ────
  fastify.post('/scheduler/analyze', async (request, reply) => {
    const reviewCount = await scheduler.analyzeUnanalyzedReviews();
    return reply.send(successResponse({
      message: `Analyzed ${reviewCount} reviews`,
      reviewsProcessed: reviewCount,
    }));
  });

  // ─── Fix UNKNOWN conditions for retail platforms ─────
  fastify.post('/fix/conditions', async (request, reply) => {
    // Update listings on Jumia/Konga that are UNKNOWN to NEW
    const result = await prisma.productListing.updateMany({
      where: {
        condition: 'UNKNOWN',
        platform: { in: ['JUMIA', 'KONGA'] },
      },
      data: { condition: 'NEW' },
    });
    return reply.send(successResponse({
      message: `Updated ${result.count} listings from UNKNOWN to NEW on retail platforms`,
      updated: result.count,
    }));
  });

  // ─── Scraper Health Check ────────────────────────────
  fastify.get('/scrapers/health', async (request, reply) => {
    // Check last successful scrape per platform
    const platforms = ['JUMIA', 'KONGA', 'JIJI', 'NAIRALAND'];
    const health: Record<string, unknown> = {};

    for (const platform of platforms) {
      const lastJob = await prisma.scrapingJob.findFirst({
        where: { platform: platform as any, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: {
          completedAt: true,
          result: true,
          createdAt: true,
        },
      });

      const lastFailed = await prisma.scrapingJob.findFirst({
        where: { platform: platform as any, status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          error: true,
        },
      });

      const listingCount = await prisma.productListing.count({
        where: { platform: platform as any },
      });

      let status: 'healthy' | 'stale' | 'failing' | 'never_run' = 'never_run';
      let staleness: string | null = null;

      if (lastJob?.completedAt) {
        const hoursSinceLastRun = (Date.now() - lastJob.completedAt.getTime()) / (1000 * 60 * 60);
        staleness = `${Math.round(hoursSinceLastRun)}h ago`;

        if (hoursSinceLastRun < 2) {
          status = 'healthy';
        } else if (hoursSinceLastRun < 24) {
          status = 'stale';
        } else {
          status = 'stale';
        }
      }

      if (lastFailed && (!lastJob?.completedAt || lastFailed.createdAt > lastJob.completedAt)) {
        status = 'failing';
      }

      health[platform] = {
        status,
        lastSuccessfulRun: lastJob?.completedAt?.toISOString() ?? null,
        lastRunAge: staleness,
        lastFailure: lastFailed ? {
          at: lastFailed.createdAt.toISOString(),
          error: (lastFailed.error ?? '').substring(0, 200),
        } : null,
        totalListings: listingCount,
      };
    }

    return reply.send(successResponse({ scrapers: health }));
  });
}
