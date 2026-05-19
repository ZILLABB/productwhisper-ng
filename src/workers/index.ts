import { Job } from 'bullmq';
import { createWorker, scheduleRecurringJobs } from '@/infrastructure/queue/bullmq';
import { IngestionService } from '@/core/services/IngestionService';
import { SentimentService } from '@/core/services/SentimentService';
import { PriceService } from '@/core/services/PriceService';
import { TrustService } from '@/core/services/TrustService';
import { connectDatabase } from '@/infrastructure/database/prisma';
import { connectRedis } from '@/infrastructure/cache/redis';
import { scraperConfig } from '@/config';
import { QUEUE_NAMES } from '@/shared/constants';

const ingestion = new IngestionService();
const sentiment = new SentimentService();
const price = new PriceService();
const trust = new TrustService();

async function handleScrapingJob(job: Job): Promise<void> {
  const { platform, query, maxResults } = job.data;

  await job.updateProgress(10);
  console.log(`[scraping] Starting ${platform} scrape for "${query}"`);

  const result = await ingestion.ingestFromPlatform(platform, query, maxResults);

  await job.updateProgress(100);
  console.log(`[scraping] Done: ${result.productsIngested} products, ${result.listingsCreated} listings, ${result.reviewsCollected} reviews`);
}

async function handleSentimentJob(job: Job): Promise<void> {
  const { productId, reviewIds } = job.data;

  await job.updateProgress(10);
  console.log(`[sentiment] Analyzing ${reviewIds.length} reviews for product ${productId}`);

  await sentiment.analyzeAndStoreReviews(productId, reviewIds);

  await job.updateProgress(100);
  console.log(`[sentiment] Done analyzing ${reviewIds.length} reviews`);
}

async function handlePriceUpdateJob(job: Job): Promise<void> {
  const { productId } = job.data;
  console.log(`[price] Updating price for product ${productId}`);
  await price.compareProductPrices(productId);
}

async function handleTrustComputeJob(job: Job): Promise<void> {
  const { entityId, entityType } = job.data;

  if (entityType === 'product') {
    console.log(`[trust] Computing trust score for product ${entityId}`);
    await trust.getProductTrust(entityId);
  } else if (entityType === 'vendor') {
    console.log(`[trust] Computing trust score for vendor ${entityId}`);
    await trust.getVendorTrust(entityId);
  }
}

export async function startWorkers(): Promise<void> {
  await connectDatabase();
  await connectRedis();

  console.log('[workers] Starting worker processes...');

  createWorker(QUEUE_NAMES.SCRAPING, handleScrapingJob, 2);
  createWorker(QUEUE_NAMES.SENTIMENT, handleSentimentJob, 3);
  createWorker(QUEUE_NAMES.PRICE_UPDATE, handlePriceUpdateJob, 5);
  createWorker(QUEUE_NAMES.TRUST_COMPUTE, handleTrustComputeJob, 3);

  await scheduleRecurringJobs(scraperConfig.intervalMinutes);

  console.log('[workers] All workers running');
}

if (require.main === module) {
  startWorkers().catch((err) => {
    console.error('[workers] Fatal error:', err);
    process.exit(1);
  });
}
