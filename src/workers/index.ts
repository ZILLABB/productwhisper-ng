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

/**
 * Default product queries for recurring scrapes.
 * These represent the most popular product categories in Nigeria.
 */
const RECURRING_SCRAPE_QUERIES: Record<string, string[]> = {
  JUMIA: [
    'Samsung Galaxy',
    'iPhone',
    'Infinix phone',
    'Tecno phone',
    'Redmi phone',
    'laptop',
    'wireless earbuds',
    'power bank',
  ],
  KONGA: [
    'Samsung Galaxy',
    'iPhone',
    'Infinix',
    'Tecno',
    'laptop',
    'television',
  ],
  JIJI: [
    'Samsung phone',
    'iPhone',
    'laptop',
    'Tecno',
    'PlayStation',
  ],
  NAIRALAND: [
    'phone review',
    'laptop review',
    'Samsung Galaxy',
    'iPhone Nigeria',
  ],
};

async function handleScrapingJob(job: Job): Promise<void> {
  const { platform, query, type, maxResults } = job.data;

  await job.updateProgress(10);

  // Handle recurring full scrape jobs (no specific query)
  if (type === 'full_scrape' || !query) {
    const queries = RECURRING_SCRAPE_QUERIES[platform] ?? ['phone'];
    console.log(`[scraping] Starting recurring ${platform} scrape (${queries.length} queries)`);

    let totalProducts = 0;
    let totalListings = 0;
    let totalReviews = 0;

    for (let i = 0; i < queries.length; i++) {
      try {
        const progress = 10 + Math.round((i / queries.length) * 80);
        await job.updateProgress(progress);

        console.log(`[scraping] ${platform}: "${queries[i]}" (${i + 1}/${queries.length})`);
        const result = await ingestion.ingestFromPlatform(platform, queries[i], 20);
        totalProducts += result.productsIngested;
        totalListings += result.listingsCreated;
        totalReviews += result.reviewsCollected;
      } catch (err) {
        console.error(`[scraping] ${platform} query "${queries[i]}" failed:`, err instanceof Error ? err.message : err);
        // Continue with next query
      }
    }

    await job.updateProgress(100);
    console.log(`[scraping] Recurring ${platform} done: ${totalProducts} products, ${totalListings} listings, ${totalReviews} reviews`);
    return;
  }

  // Handle specific query jobs
  console.log(`[scraping] Starting ${platform} scrape for "${query}"`);
  const result = await ingestion.ingestFromPlatform(platform, query, maxResults ?? 50);

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
  console.log('[workers] Built-in Nigerian Sentiment Engine loaded');

  createWorker(QUEUE_NAMES.SCRAPING, handleScrapingJob, 2);
  createWorker(QUEUE_NAMES.SENTIMENT, handleSentimentJob, 3);
  createWorker(QUEUE_NAMES.PRICE_UPDATE, handlePriceUpdateJob, 5);
  createWorker(QUEUE_NAMES.TRUST_COMPUTE, handleTrustComputeJob, 3);

  console.log(`[workers] Scheduling recurring scrapes every ${scraperConfig.intervalMinutes} minutes`);
  await scheduleRecurringJobs(scraperConfig.intervalMinutes);

  console.log('[workers] All workers running');
}

if (require.main === module) {
  startWorkers().catch((err) => {
    console.error('[workers] Fatal error:', err);
    process.exit(1);
  });
}
