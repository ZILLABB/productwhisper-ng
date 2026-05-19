import { prisma } from '@/infrastructure/database/prisma';
import { getScraper, getNairalandScraper, getYouTubeScraper } from '@/infrastructure/scrapers';
import { addSentimentJob, addTrustComputeJob, addPriceUpdateJob } from '@/infrastructure/queue/bullmq';
import { classifyCondition, extractBrand, slugify, normalizeProductName } from '@/shared/utils';
import { ProductService } from './ProductService';
import { PriceService } from './PriceService';
import type { ScrapedProduct, ScrapedReview, ScrapedVendor } from '@/shared/types';
import type { Platform, ProductCondition } from '@prisma/client';

export class IngestionService {
  private productService = new ProductService();
  private priceService = new PriceService();

  async ingestFromPlatform(platform: string, query: string, maxResults = 50): Promise<{
    productsIngested: number;
    listingsCreated: number;
    reviewsCollected: number;
  }> {
    const scraper = getScraper(platform);
    const scraped = await scraper.searchProducts({ query, maxResults });

    let productsIngested = 0;
    let listingsCreated = 0;
    let reviewsCollected = 0;

    for (const item of scraped) {
      try {
        const result = await this.processScrapedProduct(item, platform as Platform);
        if (result.isNew) productsIngested++;
        listingsCreated++;
        reviewsCollected += result.reviewCount;
      } catch (err) {
        console.error(`Failed to ingest ${item.title}:`, err instanceof Error ? err.message : err);
      }
    }

    await this.recordJob(platform as Platform, 'SCRAPE_PRODUCTS', 'COMPLETED', { query, productsIngested, listingsCreated, reviewsCollected });

    return { productsIngested, listingsCreated, reviewsCollected };
  }

  async processScrapedProduct(scraped: ScrapedProduct, platform: Platform): Promise<{ isNew: boolean; productId: string; reviewCount: number }> {
    const product = await this.productService.findOrCreateProduct(
      scraped.title,
      scraped.metadata?.brand as string ?? extractBrand(scraped.title),
      scraped.metadata?.category as string
    );

    if (!product) throw new Error(`Could not create product for: ${scraped.title}`);

    let vendorId: string | undefined;
    if (scraped.vendor) {
      const vendor = await this.upsertVendor(scraped.vendor, platform);
      vendorId = vendor.id;
    }

    const condition = (classifyCondition(scraped.title) || 'UNKNOWN') as ProductCondition;

    await prisma.productListing.upsert({
      where: { platform_externalId: { platform, externalId: scraped.externalId } },
      update: {
        title: scraped.title,
        price: scraped.price,
        condition,
        url: scraped.url,
        imageUrl: scraped.imageUrl,
        vendorId,
        lastScrapedAt: new Date(),
        metadata: (scraped.metadata ?? {}) as any,
      },
      create: {
        productId: product.id,
        platform,
        externalId: scraped.externalId,
        title: scraped.title,
        price: scraped.price,
        currency: scraped.currency || 'NGN',
        condition,
        url: scraped.url,
        imageUrl: scraped.imageUrl,
        vendorId,
        metadata: (scraped.metadata ?? {}) as any,
      },
    });

    await this.priceService.recordPriceSnapshot(product.id, platform, scraped.price, condition);

    let reviewCount = 0;
    if (scraped.reviews && scraped.reviews.length > 0) {
      const listing = await prisma.productListing.findUnique({
        where: { platform_externalId: { platform, externalId: scraped.externalId } },
      });
      if (listing) {
        reviewCount = await this.ingestReviews(listing.id, platform, scraped.reviews);

        const reviewIds = await prisma.review.findMany({
          where: { listingId: listing.id, sentimentAnalysis: null },
          select: { id: true },
          take: 50,
        });

        if (reviewIds.length > 0) {
          await addSentimentJob(product.id, reviewIds.map(r => r.id)).catch(() => {});
        }
      }
    }

    return { isNew: true, productId: product.id, reviewCount };
  }

  async ingestReviews(listingId: string, platform: Platform, reviews: ScrapedReview[]): Promise<number> {
    let count = 0;
    for (const review of reviews) {
      try {
        await prisma.review.upsert({
          where: { platform_externalId: { platform, externalId: review.externalId } },
          update: {
            content: review.content,
            rating: review.rating,
            title: review.title,
            helpfulCount: review.helpfulCount ?? 0,
          },
          create: {
            listingId,
            platform,
            externalId: review.externalId,
            author: review.author,
            rating: review.rating,
            title: review.title,
            content: review.content,
            helpfulCount: review.helpfulCount ?? 0,
            postedAt: review.postedAt ? new Date(review.postedAt) : null,
          },
        });
        count++;
      } catch (err) {
        console.error(`Failed to ingest review ${review.externalId}:`, err instanceof Error ? err.message : err);
      }
    }
    return count;
  }

  async ingestNairalandDiscussions(query: string, maxPages = 3): Promise<{ postsProcessed: number }> {
    const nairaland = getNairalandScraper();
    const posts = await nairaland.searchDiscussions(query, maxPages);

    let postsProcessed = 0;
    for (const post of posts) {
      try {
        const detailed = await nairaland.getDiscussionDetails(post.url);
        if (!detailed) continue;

        const product = await this.productService.findOrCreateProduct(query);
        if (!product) continue;

        const allTexts = [detailed.content, ...detailed.replies.map(r => r.content)].filter(t => t.length > 20);

        for (const text of allTexts) {
          await prisma.sentimentAnalysis.create({
            data: {
              productId: product.id,
              platform: 'NAIRALAND',
              sentimentScore: 0,
              confidence: 0,
              keyComplaints: [],
              keyPraises: [],
              scamSignals: [],
              rawOutput: { sourceUrl: post.url, text: text.substring(0, 2000) },
            },
          });
        }

        postsProcessed++;
      } catch (err) {
        console.error('Nairaland ingestion error:', err instanceof Error ? err.message : err);
      }
    }

    return { postsProcessed };
  }

  async getIngestionStatus(): Promise<{
    recentJobs: unknown[];
    stats: { platform: string; totalJobs: number; lastRun: string | null }[];
  }> {
    const recentJobs = await prisma.scrapingJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const stats = await prisma.scrapingJob.groupBy({
      by: ['platform'],
      _count: { id: true },
      _max: { completedAt: true },
    });

    return {
      recentJobs,
      stats: stats.map(s => ({
        platform: s.platform,
        totalJobs: s._count.id,
        lastRun: s._max.completedAt?.toISOString() ?? null,
      })),
    };
  }

  private async upsertVendor(vendor: ScrapedVendor, platform: Platform) {
    return prisma.vendor.upsert({
      where: { platform_externalId: { platform, externalId: vendor.externalId || vendor.name } },
      update: {
        name: vendor.name,
        profileUrl: vendor.profileUrl,
        rating: vendor.rating,
        totalSales: vendor.totalSales ?? 0,
        isVerified: vendor.isVerified ?? false,
      },
      create: {
        platform,
        externalId: vendor.externalId || vendor.name,
        name: vendor.name,
        profileUrl: vendor.profileUrl,
        rating: vendor.rating,
        totalSales: vendor.totalSales ?? 0,
        isVerified: vendor.isVerified ?? false,
      },
    });
  }

  private async recordJob(platform: Platform, type: string, status: string, result: unknown) {
    await prisma.scrapingJob.create({
      data: {
        type: type as any,
        platform,
        status: status as any,
        result: result as any,
        completedAt: new Date(),
      },
    });
  }
}
