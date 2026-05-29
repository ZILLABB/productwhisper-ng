/**
 * Built-in scheduler — runs recurring scrapes and analysis
 * without Redis/BullMQ dependency.
 *
 * Falls back to this when Redis is unavailable.
 */

import { IngestionService } from './IngestionService';
import { SentimentService } from './SentimentService';
import { TrustService } from './TrustService';
import { prisma } from '@/infrastructure/database/prisma';
import { scraperConfig } from '@/config';

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
};

export class SchedulerService {
  private ingestion = new IngestionService();
  private sentiment = new SentimentService();
  private trust = new TrustService();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * Start the built-in scheduler.
   * Runs an initial scrape cycle after 30s, then repeats at the configured interval.
   */
  start(): void {
    if (this.intervalHandle) return;

    const intervalMs = scraperConfig.intervalMinutes * 60 * 1000;

    console.log(`[scheduler] Starting built-in scheduler (every ${scraperConfig.intervalMinutes}min)`);

    // Run first cycle after 30s to let the server finish booting
    setTimeout(() => this.runCycle(), 30_000);

    this.intervalHandle = setInterval(() => this.runCycle(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Run one full cycle: scrape all platforms → analyze sentiment → compute trust.
   */
  async runCycle(): Promise<void> {
    if (this.isRunning) {
      console.log('[scheduler] Previous cycle still running, skipping');
      return;
    }

    this.isRunning = true;
    const start = Date.now();
    console.log('[scheduler] ═══ Starting scrape cycle ═══');

    try {
      // Phase 1: Scrape each platform sequentially to avoid overwhelming targets
      for (const [platform, queries] of Object.entries(RECURRING_SCRAPE_QUERIES)) {
        for (const query of queries) {
          try {
            console.log(`[scheduler] Scraping ${platform}: "${query}"`);
            const result = await this.ingestion.ingestFromPlatform(platform, query, 15);
            console.log(`[scheduler]   → ${result.listingsCreated} listings, ${result.reviewsCollected} reviews`);
          } catch (err) {
            console.error(`[scheduler] ${platform}/"${query}" failed:`, err instanceof Error ? err.message : err);
          }
          // Small delay between queries to be respectful
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      // Phase 2: Analyze any unanalyzed reviews
      await this.analyzeUnanalyzedReviews();

      // Phase 3: Recompute trust scores for products with new data
      await this.recomputeTrustScores();

      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[scheduler] ═══ Cycle complete in ${elapsed}s ═══`);
    } catch (err) {
      console.error('[scheduler] Cycle error:', err instanceof Error ? err.message : err);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Analyze all reviews that don't have a sentiment analysis yet.
   */
  async analyzeUnanalyzedReviews(): Promise<number> {
    const unanalyzed = await prisma.review.findMany({
      where: { sentimentAnalysis: null },
      select: {
        id: true,
        listing: { select: { productId: true } },
      },
      take: 200,
    });

    if (unanalyzed.length === 0) {
      console.log('[scheduler] No unanalyzed reviews');
      return 0;
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
      try {
        const processed = await this.sentiment.analyzeAndStoreReviews(productId, reviewIds);
        totalProcessed += processed;
      } catch (err) {
        console.error(`[scheduler] Sentiment analysis failed for product ${productId}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[scheduler] Analyzed ${totalProcessed} reviews across ${byProduct.size} products`);
    return totalProcessed;
  }

  /**
   * Recompute trust scores for products updated in the last cycle.
   */
  private async recomputeTrustScores(): Promise<void> {
    // Find products with recent listings (updated in last 2 hours)
    const recentProducts = await prisma.product.findMany({
      where: {
        listings: {
          some: {
            lastScrapedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
        },
      },
      select: { id: true },
      take: 50,
    });

    if (recentProducts.length === 0) return;

    console.log(`[scheduler] Recomputing trust scores for ${recentProducts.length} products`);
    for (const { id } of recentProducts) {
      try {
        await this.trust.getProductTrust(id);
      } catch {
        // Non-fatal
      }
    }
  }
}
